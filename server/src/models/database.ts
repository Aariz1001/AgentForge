import { DataSource } from 'typeorm';
import { Tool, ToolValidation, ExecutionLog } from './schema';
import { settings } from '../core/config';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: settings.database.url,
  synchronize: settings.environment === 'development',
  logging: settings.database.echo,
  entities: [Tool, ToolValidation, ExecutionLog],
  migrations: [],
  subscribers: [],
});

export const initDatabase = async () => {
  try {
    await AppDataSource.initialize();
    console.log('Data Source has been initialized!');
    
    // Initialize pgvector extension
    await AppDataSource.query('CREATE EXTENSION IF NOT EXISTS vector');
    await AppDataSource.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    
  } catch (err) {
    console.error('Error during Data Source initialization', err);
    throw err;
  }
};
