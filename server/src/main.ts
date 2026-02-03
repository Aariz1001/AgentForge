import * as express from 'express';
import { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { join } from 'path';
import { settings } from './core/config';
import { initDatabase, AppDataSource } from './models/database';
import { Tool } from './models/schema';
import {
  DatabaseService,
  OpenRouterService,
  OrchestrationService,
  MemoryEngine,
  TodoRegistry,
  PlanWriter,
  SwarmOrchestrator,
  SwarmStore,
  MCPManagerService,
  SkillManagerService
} from './services';

const app = (express as any).default ? (express as any).default() : (express as any)();

const runtimeConfig = {
  get: (key: string) => key.split('.').reduce((acc: any, part) => {
    if (acc && typeof acc === 'object' && part in acc) {
      return acc[part];
    }
    return undefined;
  }, settings),
  set: () => undefined
};

const db = new DatabaseService(settings.database.url);
const openrouter = new OpenRouterService(runtimeConfig);
const orchestrator = new OrchestrationService(runtimeConfig, db);
const memoryEngine = new MemoryEngine({
  maxEntries: settings.swarm.memory.maxEntries,
  ttlSeconds: settings.swarm.memory.ttlSeconds,
  persistPath: join(settings.dataDir, 'memory', 'memories.json')
});
const todoRegistry = new TodoRegistry({
  maxItems: settings.swarm.todo.maxItems
});
const planWriter = new PlanWriter();
const mcpManager = new MCPManagerService(db, settings.mcp.servers);
const skillManager = new SkillManagerService(settings.skills.paths);
const swarmStore = new SwarmStore();
const swarm = new SwarmOrchestrator(runtimeConfig, {
  openrouter,
  orchestrator,
  memory: memoryEngine,
  todos: todoRegistry,
  planWriter
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: settings.api.corsOrigins,
  credentials: settings.api.corsAllowCredentials,
  methods: settings.api.corsAllowMethods,
  allowedHeaders: settings.api.corsAllowHeaders,
}));
app.use(express.json({ limit: settings.safety.maxInputSizeBytes }));
app.use(morgan(settings.logging.level.toLowerCase() === 'debug' ? 'dev' : 'combined'));

// Health check endpoints
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    version: settings.appVersion,
    environment: settings.environment
  });
});

app.get('/health/ready', async (req: Request, res: Response) => {
  const checks = {
    database: AppDataSource.isInitialized,
    openrouter: true, // Placeholder
    orchestrator: true, // Placeholder
  };
  
  const allReady = Object.values(checks).every(v => v);
  
  res.json({
    ready: allReady,
    checks
  });
});

app.get('/health/live', (req: Request, res: Response) => {
  res.json({ alive: true });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: settings.appName,
    version: settings.appVersion,
    documentation: '/docs',
    health: '/health'
  });
});

// Task execution endpoint (Placeholder)
app.post('/execute', async (req: Request, res: Response) => {
  const { task, sessionId, context } = req.body;
  
  // Logic to call orchestrator would go here
  
  res.json({
    status: 'success',
    task,
    response: "This is a placeholder response from the TS backend."
  });
});

// Tool generation endpoint (Placeholder)
app.post('/forge/generate', async (req: Request, res: Response) => {
  const { name, purpose } = req.body;
  
  // Logic to call forge service would go here
  
  res.json({
    success: true,
    content_hash: "placeholder_hash",
    message: `Generated tool ${name} for ${purpose}`
  });
});

app.post('/swarm/run', async (req: Request, res: Response) => {
  try {
    const result = await swarm.runSwarm(req.body);
    swarmStore.save(result);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Swarm failed' });
  }
});

app.get('/swarm/run/:id', (req: Request, res: Response) => {
  const result = swarmStore.get(req.params.id);
  if (!result) {
    res.status(404).json({ error: 'Swarm run not found' });
    return;
  }
  res.json(result);
});

app.get('/swarm/memory', (req: Request, res: Response) => {
  res.json({ entries: memoryEngine.list() });
});

// Memory Management
app.post('/memory/store', (req: Request, res: Response) => {
  const { content, key, tier, tags, source, metadata, importance, pinned } = req.body || {};
  if (typeof content !== 'string' || content.trim().length === 0) {
    res.status(400).json({ error: 'content must be a non-empty string' });
    return;
  }

  const record = memoryEngine.remember(content, {
    key,
    tier,
    tags,
    source,
    metadata,
    importance,
    pinned
  });
  res.json({ record });
});

app.post('/memory/search', (req: Request, res: Response) => {
  const { query, limit, tiers, tags, source, weights, includeMetadata } = req.body || {};
  const results = memoryEngine.search(String(query || ''), {
    limit,
    tiers,
    tags,
    source,
    weights,
    includeMetadata
  });
  res.json({ results });
});

app.post('/memory/consolidate', (_req: Request, res: Response) => {
  const promoted = memoryEngine.consolidate();
  res.json({ promoted });
});

app.get('/swarm/todos', (req: Request, res: Response) => {
  res.json({ todos: todoRegistry.list() });
});

// MCP Management
app.get('/mcp/servers', async (req: Request, res: Response) => {
  const servers = await mcpManager.listServers();
  res.json({ servers });
});

app.post('/mcp/query', async (req: Request, res: Response) => {
  const { serverId, query } = req.body;
  try {
    const result = await mcpManager.queryDocs(serverId, query);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Skill Management
app.get('/skills', async (req: Request, res: Response) => {
  const skills = await skillManager.scanSkills();
  res.json({ skills });
});

app.get('/skills/:id', async (req: Request, res: Response) => {
  const skill = await skillManager.getSkill(req.params.id);
  if (!skill) return res.status(404).json({ error: 'Skill not found' });
  res.json({ skill });
});

// Start server
const start = async () => {
  try {
    await initDatabase();
    await memoryEngine.load();
    
    app.listen(settings.api.port, settings.api.host, () => {
      console.log(`==================================================`);
      console.log(`Starting ${settings.appName} v${settings.appVersion}`);
      console.log(`Environment: ${settings.environment}`);
      console.log(`Server listening on http://${settings.api.host}:${settings.api.port}`);
      console.log(`==================================================`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

start();
