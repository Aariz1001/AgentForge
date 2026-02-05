import { z } from 'zod';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const DatabaseSettingsSchema = z.object({
  url: z.string().default('postgresql+psycopg://localhost:5432/agentforge'),
  echo: z.boolean().default(false),
  poolSize: z.number().min(1).default(10),
  maxOverflow: z.number().min(0).default(20),
  connectRetryAttempts: z.number().min(1).default(3),
  connectRetryDelay: z.number().min(0.1).default(1.0),
});

const RedisSettingsSchema = z.object({
  url: z.string().default('redis://localhost:6379/0'),
  connectionPoolSize: z.number().min(1).default(50),
  socketTimeout: z.number().min(0.1).default(5.0),
  socketConnectTimeout: z.number().min(0.1).default(5.0),
  hotBufferTtl: z.number().min(60).default(3600),
  hotBufferMaxSize: z.number().min(100).default(10000),
});

const OpenRouterSettingsSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().default('https://openrouter.ai/api/v1'),
  primaryModel: z.string().default('anthropic/claude-3.5-sonnet'),
  fallbackModels: z.array(z.string()).default(['openai/gpt-4o', 'google/gemini-pro']),
  defaultTemperature: z.number().min(0).max(2).default(0.7),
  defaultMaxTokens: z.number().min(0).max(128000).default(0),
  defaultTopP: z.number().min(0).max(1).optional(),
  trackCosts: z.boolean().default(true),
  maxCostPerRequestUsd: z.number().min(0).default(0.0),
  requestTimeout: z.number().min(0).default(0.0),
  requestsPerMinute: z.number().min(0).default(0),
  tokensPerMinute: z.number().min(0).default(0),
});

const SafetySettingsSchema = z.object({
  maxDepth: z.number().min(0).default(0),
  maxBudgetUsd: z.number().min(0).default(0.0),
  defaultBudgetUsd: z.number().min(0).default(0.0),
  circuitBreakerThreshold: z.number().min(0).default(0),
  circuitBreakerTimeout: z.number().min(0).default(0.0),
  maxInputSizeBytes: z.number().min(1024).default(1024 * 1024),
  maxOutputSizeBytes: z.number().min(1024).default(10 * 1024 * 1024),
  forbiddenImports: z.array(z.string()).default([
    'os.system', 'subprocess', 'eval', 'exec', 'compile', '__import__', 'importlib'
  ]),
  forbiddenBuiltins: z.array(z.string()).default([
    'eval', 'exec', 'compile', 'open', 'input'
  ]),
});

const LoggingSettingsSchema = z.object({
  level: z.enum(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']).default('INFO'),
  format: z.string().default('%(asctime)s - %(name)s - %(levelname)s - %(message)s'),
  jsonFormat: z.boolean().default(false),
  filePath: z.string().optional(),
  fileMaxBytes: z.number().min(1024).default(10 * 1024 * 1024),
  fileBackupCount: z.number().min(0).default(5),
});

const APISettingsSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().min(1).max(65535).default(8000),
  workers: z.number().min(1).default(1),
  reload: z.boolean().default(false),
  secretKey: z.string().default('secret-key'), // Should be env-managed
  accessTokenExpireMinutes: z.number().min(1).default(30),
  corsOrigins: z.array(z.string()).default(['*']),
  corsAllowCredentials: z.boolean().default(true),
  corsAllowMethods: z.array(z.string()).default(['*']),
  corsAllowHeaders: z.array(z.string()).default(['*']),
  rateLimitRequests: z.number().min(1).default(100),
  rateLimitWindow: z.number().min(1).default(60),
});

const ForgeSettingsSchema = z.object({
  maxGenerationAttempts: z.number().min(1).default(3),
  generationTimeout: z.number().min(10).default(120.0),
  runSyntheticTests: z.boolean().default(true),
  minTestCoverage: z.number().min(0).max(1).default(0.8),
  prbThreshold: z.number().min(0).max(1).default(0.7),
  prbDimensions: z.array(z.string()).default([
    'correctness', 'efficiency', 'safety', 'maintainability', 'documentation'
  ]),
});

const SwarmRouterSettingsSchema = z.object({
  useLLM: z.boolean().default(true),
  maxTargets: z.number().min(1).default(6),
  model: z.string().optional(),
});

const SwarmMemorySettingsSchema = z.object({
  adapter: z.enum(['memory', 'redis']).default('memory'),
  ttlSeconds: z.number().min(0).default(3600),
  maxEntries: z.number().min(1).default(2000),
});

const SwarmTodoSettingsSchema = z.object({
  maxItems: z.number().min(1).default(2000),
});

const SwarmSettingsSchema = z.object({
  maxAgents: z.number().min(1).default(8),
  defaultAgents: z.number().min(1).default(3),
  concurrency: z.number().min(1).default(3),
  planDir: z.string().default('plan'),
  mergeModel: z.string().optional(),
  router: SwarmRouterSettingsSchema.default({}),
  memory: SwarmMemorySettingsSchema.default({}),
  todo: SwarmTodoSettingsSchema.default({}),
});

const MCPSettingsSchema = z.object({
  servers: z.array(z.object({
    id: z.string(),
    url: z.string(),
    name: z.string()
  })).default([
    { id: 'context7', url: 'https://mcp.context7.io', name: 'Context7 Documentation Server' },
    { id: 'langchain', url: 'https://mcp.langchain.com', name: 'LangChain Docs Server' }
  ])
});

const PhoenixTapeSettingsSchema = z.object({
  replayMode: z.enum(['strict', 'best_effort']).default('strict'),
  defaultTimeoutMs: z.number().min(1000).default(30000),
  orphanGraceMs: z.number().min(0).default(5000),
  heapThresholdMb: z.number().min(0).default(0),
  proceduralThreshold: z.number().min(0).max(1).default(0.85),
  retentionDays: z.number().min(1).default(30),
  compactionIntervalMs: z.number().min(1000).default(15 * 60 * 1000),
  compactionWindowHours: z.number().min(1).default(24),
  compactionMinCount: z.number().min(1).default(5),
  compactionKeepPerTool: z.number().min(1).default(3),
  compactionMaxDeletes: z.number().min(0).default(5000),
  memoryCompactionIntervalMs: z.number().min(1000).default(20 * 60 * 1000)
});

const SkillsSettingsSchema = z.object({
  paths: z.array(z.string()).default([
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.copilot/skills'),
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude/skills')
  ])
});

const SettingsSchema = z.object({
  appName: z.string().default('AgentForge Kernel'),
  appVersion: z.string().default('1.0.0'),
  debug: z.boolean().default(false),
  environment: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  database: DatabaseSettingsSchema.default({}),
  redis: RedisSettingsSchema.default({}),
  openrouter: OpenRouterSettingsSchema.default({}),
  safety: SafetySettingsSchema.default({}),
  logging: LoggingSettingsSchema.default({}),
  api: APISettingsSchema.default({}),
  forge: ForgeSettingsSchema.default({}),
  swarm: SwarmSettingsSchema.default({}),
  mcp: MCPSettingsSchema.default({}),
  phoenixTape: PhoenixTapeSettingsSchema.default({}),
  skills: SkillsSettingsSchema.default({}),
  dataDir: z.string().default('/tmp/agentforge'),
  cacheDir: z.string().default('/tmp/agentforge/cache'),
});

export type Settings = z.infer<typeof SettingsSchema>;

const loadSettings = (): Settings => {
  const settings = {
    appName: process.env.APP_NAME,
    appVersion: process.env.APP_VERSION,
    debug: process.env.DEBUG === 'true',
    environment: process.env.ENVIRONMENT,
    database: {
      url: process.env.DB_URL,
      echo: process.env.DB_ECHO === 'true',
      poolSize: process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE) : undefined,
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY,
    }
    // ... add more as needed
  };

  const validated = SettingsSchema.parse(settings);
  
  // Ensure paths
  if (!fs.existsSync(validated.dataDir)) fs.mkdirSync(validated.dataDir, { recursive: true });
  if (!fs.existsSync(validated.cacheDir)) fs.mkdirSync(validated.cacheDir, { recursive: true });
  
  return validated;
};

export const settings = loadSettings();
