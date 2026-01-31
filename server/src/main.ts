import * as express from 'express';
import { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { settings } from './core/config';
import { initDatabase, AppDataSource } from './models/database';
import { Tool } from './models/schema';
import {
  DatabaseService,
  OpenRouterService,
  OrchestrationService,
  SharedMemoryService,
  TodoRegistry,
  PlanWriter,
  SwarmOrchestrator,
  SwarmStore
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
const sharedMemory = new SharedMemoryService({
  maxEntries: settings.swarm.memory.maxEntries,
  ttlSeconds: settings.swarm.memory.ttlSeconds
});
const todoRegistry = new TodoRegistry({
  maxItems: settings.swarm.todo.maxItems
});
const planWriter = new PlanWriter();
const swarmStore = new SwarmStore();
const swarm = new SwarmOrchestrator(runtimeConfig, {
  openrouter,
  orchestrator,
  memory: sharedMemory,
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
  res.json({ entries: sharedMemory.list() });
});

app.get('/swarm/todos', (req: Request, res: Response) => {
  res.json({ todos: todoRegistry.list() });
});

// Start server
const start = async () => {
  try {
    await initDatabase();
    
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
