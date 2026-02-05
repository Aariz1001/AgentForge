import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  Index,
  Unique,
  JoinColumn,
} from 'typeorm';

@Entity('tools')
@Index('idx_tools_status', ['status'])
@Index('idx_tools_risk_level', ['riskLevel'])
export class Tool {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tool_hash', length: 64, unique: true })
  @Index()
  toolHash!: string;

  @Column({ length: 128 })
  @Index()
  name!: string;

  @Column({ length: 32 })
  version!: string;

  @Column('text')
  description!: string;

  @Column({ length: 256 })
  author!: string;

  @Column({ length: 64, default: 'MIT' })
  license!: string;

  @Column('text')
  sourceCode!: string;

  @Column('jsonb', { default: {} })
  manifest!: any;

  @Column('jsonb', { default: [] })
  dependencies!: any[];

  @Column({ length: 32, default: 'typescript' })
  runtime!: string;

  @Column({ name: 'entry_point', length: 256, default: 'main' })
  entryPoint!: string;

  @Column({ name: 'timeout_seconds', default: 30 })
  timeoutSeconds!: number;

  @Column({ name: 'memory_limit_mb', default: 512 })
  memoryLimitMb!: number;

  @Column('jsonb', { default: [] })
  tags!: string[];

  @Column({ name: 'risk_level', length: 16, default: 'low' })
  riskLevel!: string;

  @Column({ length: 32, default: 'draft' })
  status!: string;

  @Column('text', { nullable: true }) // Using text for vector storage representation for now
  embedding?: string;

  @Column('text', { nullable: true })
  signature?: string;

  @Column({ name: 'signed_by', length: 256, nullable: true })
  signedBy?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => ToolValidation, (validation) => validation.tool)
  validations!: ToolValidation[];

  @OneToMany(() => ExecutionLog, (log) => log.tool)
  executions!: ExecutionLog[];
}

@Entity('tool_validations')
@Index('idx_validations_status', ['status'])
@Index('idx_validations_tool_id', ['toolId'])
export class ToolValidation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { name: 'tool_id' })
  toolId!: string;

  @ManyToOne(() => Tool, (tool) => tool.validations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tool_id' })
  tool!: Tool;

  @Column({ name: 'validation_id', length: 64, unique: true })
  @Index()
  validationId!: string;

  @Column({ length: 32, default: 'pending' })
  status!: string;

  @Column({ name: 'tests_passed', default: 0 })
  testsPassed!: number;

  @Column({ name: 'tests_failed', default: 0 })
  testsFailed!: number;

  @Column('jsonb', { name: 'security_scan', default: {} })
  securityScan!: any;

  @Column('jsonb', { name: 'static_analysis', default: {} })
  staticAnalysis!: any;

  @Column('jsonb', { name: 'test_results', default: [] })
  testResults!: any[];

  @Column('jsonb', { default: [] })
  errors!: any[];

  @Column('jsonb', { default: [] })
  warnings!: any[];

  @Column({ name: 'validator_version', length: 32, default: '1.0.0' })
  validatorVersion!: string;

  @CreateDateColumn({ name: 'validated_at' })
  validatedAt!: Date;

  @Column({ name: 'duration_ms', nullable: true })
  durationMs?: number;
}

@Entity('execution_logs')
@Index('idx_exec_logs_status', ['status'])
@Index('idx_exec_logs_tool_hash', ['toolHash'])
@Index('idx_exec_logs_started_at', ['startedAt'])
export class ExecutionLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'request_id', length: 64, unique: true })
  @Index()
  requestId!: string;

  @Column('uuid', { name: 'tool_id', nullable: true })
  toolId?: string;

  @ManyToOne(() => Tool, (tool) => tool.executions, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'tool_id' })
  tool?: Tool;

  @Column({ name: 'tool_hash', length: 64 })
  @Index()
  toolHash!: string;

  @Column({ length: 32 })
  status!: string;

  @Column('jsonb', { default: {} })
  inputs!: any;

  @Column('jsonb', { nullable: true })
  outputs?: any;

  @Column('text', { nullable: true })
  error?: string;

  @Column({ name: 'execution_time_ms' })
  executionTimeMs!: number;

  @Column('float', { name: 'memory_peak_mb', default: 0.0 })
  memoryPeakMb!: number;

  @Column('float', { name: 'cost_usd', default: 0.0 })
  costUsd!: number;

  @Column('jsonb', { default: {} })
  context!: any;

  @Column({ default: 0 })
  depth!: number;

  @Column({ name: 'sandbox_id', length: 128, nullable: true })
  sandboxId?: string;

  @Column('timestamp with time zone', { name: 'started_at' })
  startedAt!: Date;

  @Column('timestamp with time zone', { name: 'completed_at' })
  completedAt!: Date;
}

@Entity('tool_tape_entries')
@Index('idx_tool_tape_idempotency_key', ['idempotencyKey'], { unique: true })
@Index('idx_tool_tape_status', ['status'])
@Index('idx_tool_tape_tool_hash', ['toolHash'])
@Index('idx_tool_tape_started_at', ['startedAt'])
export class ToolTapeEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tool_hash', length: 64 })
  @Index()
  toolHash!: string;

  @Column({ name: 'run_id', length: 64 })
  runId!: string;

  @Column({ name: 'trace_id', length: 64 })
  traceId!: string;

  @Column({ name: 'step_id', length: 64 })
  stepId!: string;

  @Column({ length: 32 })
  status!: string;

  @Column({ name: 'idempotency_key', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'context_fingerprint', length: 128, nullable: true })
  contextFingerprint?: string;

  @Column({ default: false })
  pinned!: boolean;

  @Column('jsonb', { name: 'args_json', default: {} })
  argsJson!: any;

  @Column('jsonb', { name: 'result_json', nullable: true })
  resultJson?: any;

  @Column({ name: 'timeout_ms', nullable: true })
  timeoutMs?: number;

  @Column('text', { nullable: true })
  error?: string;

  @Column('timestamp with time zone', { name: 'started_at' })
  startedAt!: Date;

  @Column('timestamp with time zone', { name: 'last_used_at', nullable: true })
  lastUsedAt?: Date;

  @Column('timestamp with time zone', { name: 'finished_at', nullable: true })
  finishedAt?: Date;
}

@Entity('tool_tape_compactions')
@Index('idx_tool_tape_compaction_tool_hash', ['toolHash'])
@Index('idx_tool_tape_compaction_window', ['windowStart', 'windowEnd'])
export class ToolTapeCompaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tool_hash', length: 64 })
  toolHash!: string;

  @Column({ name: 'context_fingerprint', length: 128, nullable: true })
  contextFingerprint?: string;

  @Column('timestamp with time zone', { name: 'window_start' })
  windowStart!: Date;

  @Column('timestamp with time zone', { name: 'window_end' })
  windowEnd!: Date;

  @Column({ name: 'total_count' })
  totalCount!: number;

  @Column({ name: 'success_count' })
  successCount!: number;

  @Column({ name: 'failure_count' })
  failureCount!: number;

  @Column({ name: 'distinct_idempotency' })
  distinctIdempotency!: number;

  @Column('text', { name: 'digest', nullable: true })
  digest?: string;

  @Column('jsonb', { name: 'summary_json', default: {} })
  summaryJson!: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
// Other entities omitted for brevity but should be added in a real scenario
