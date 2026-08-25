import { createApp } from './app.js';
import { env } from './config/env.js';
import { initDatabase, closeDatabase } from './database/db.js';

async function startServer(): Promise<void> {
  try {
    console.log('⚡ Starting FieldLine Local Monolith...');
    
    // Initialize SQLite database
    initDatabase();
    console.log(`📦 Local SQLite initialized at: ${env.DATABASE_PATH}`);

    const app = createApp();
    const port = env.PORT;

    const server = app.listen(port, () => {
      console.log(`🚀 FieldLine Backend running locally on http://localhost:${port}`);
      console.log(`🩺 Health check available at: http://localhost:${port}/api/health`);
    });

    // Graceful shutdown handlers
    const handleShutdown = (signal: string) => {
      console.log(`\n🛑 Received ${signal}. Shutting down FieldLine server gracefully...`);
      server.close(() => {
        closeDatabase();
        console.log('🔒 Database connection closed. Server exited cleanly.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  } catch (error) {
    console.error('❌ Failed to start FieldLine backend:', error);
    process.exit(1);
  }
}

// Start server when executed directly
startServer();
