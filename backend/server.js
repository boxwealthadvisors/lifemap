import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables - .env file is optional in production
const envPath = path.resolve(__dirname, '.env');
console.log('🔎 Resolving .env at:', envPath, 'exists?', fs.existsSync(envPath));

if (fs.existsSync(envPath)) {
  // Only read .env file if it exists (for local development)
  const envContent = fs.readFileSync(envPath, 'utf8');
  console.log('📄 .env file content:');
  console.log(envContent);
  console.log('📄 End of .env content');
  dotenv.config({ path: envPath });
} else {
  console.log('📄 No .env file found, using environment variables from Railway');
  dotenv.config(); // Load from process.env
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import pool from './config/database.js';
import { ensureLifemapMockupSchema } from './scripts/ensure-lifemap-mockup-schema.js';
import { purgeExpiredDeletedItems } from './lib/security.js';
import { runDailyLogArchive } from './lib/logArchive.js';

// Import routes
import authRoutes from './routes/auth.js';
import financialRoutes from './routes/financial.js';
import adminRoutes from './routes/admin.js';
import { authenticateToken } from './middleware/auth.js';
import { authenticateAdmin } from './middleware/adminAuth.js';

const app = express();
const PORT = process.env.PORT || 10000;

// Security middleware
app.use(helmet());

// Rate limiting - More generous for development
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 2000, // Increased for development
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count 200s
  message: {
    error: 'Too many requests from this IP, please try again later.'
  }
});

app.use(limiter);

// CORS configuration
console.log('🔍 CORS_ORIGIN from env:', process.env.CORS_ORIGIN);
const corsOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://192.168.68.80:5173', 'http://192.168.68.80:5174'];
console.log('🔍 Parsed CORS origins:', corsOrigins);
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed =
      corsOrigins.includes(origin) ||
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:') ||
      origin.startsWith('http://192.168.');
    return callback(allowed ? null : new Error('Not allowed by CORS'), allowed);
  },
  credentials: true,
  optionsSuccessStatus: 200
};

// Preflight handling and short caching for OPTIONS
app.options('*', cors(corsOptions));
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '600'); // 10 minutes
  }
  next();
});
app.use(cors(corsOptions));

// Lightweight per-client concurrency guard (request queue)
const requestInFlight = new Map();
const MAX_CONCURRENT_REQUESTS = parseInt(process.env.MAX_CONCURRENT_REQUESTS || '50');

app.use((req, res, next) => {
  const clientId = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const key = String(clientId);

  const current = requestInFlight.get(key) || 0;
  if (current >= MAX_CONCURRENT_REQUESTS) {
    res.setHeader('Retry-After', '1');
    return res.status(429).json({ error: 'Too many concurrent requests. Please slow down.' });
  }
  requestInFlight.set(key, current + 1);

  const done = () => {
    const cur = requestInFlight.get(key) || 1;
    if (cur <= 1) requestInFlight.delete(key);
    else requestInFlight.set(key, cur - 1);
  };
  res.on('finish', done);
  res.on('close', done);
  res.on('error', done);
  next();
});

// Request monitoring middleware
app.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  
  res.send = function(data) {
    const duration = Date.now() - start;
    console.log(`[REQ] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
    originalSend.call(this, data);
  };
  
  // Log request start
  console.log(`[REQ] ${req.method} ${req.path} - Started`);
  next();
});

// Body parsing middleware
app.use(express.json({ limit: '1mb' })); // Reduced from 10mb to prevent memory issues
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// Health check endpoint with memory monitoring
app.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid,
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB'
    }
  });
});

// Database initialization endpoint
app.post('/init-db', async (req, res) => {
  try {
    console.log('🔧 Initializing database schema...');
    
    // Read and execute the complete schema
    const schemaPath = path.join(__dirname, 'scripts', 'complete-schema.sql');
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');
    
    await pool.query(schemaSQL);
    console.log('✅ Database schema initialized successfully');

    // Verify tables were created
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    const tables = tablesResult.rows.map(row => row.table_name);
    console.log('📊 Created tables:', tables);

    res.json({
      status: 'success',
      message: 'Database schema initialized successfully',
      tables: tables
    });
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to initialize database',
      error: error.message
    });
  }
});

// API routes
app.use('/api', authRoutes);
app.use('/api/financial', authenticateToken, financialRoutes);
app.use('/api/admin', adminRoutes);
// Admin access to user financial data (requires userId parameter)
import adminFinancialRoutes from './routes/adminFinancial.js';
app.use('/api/admin/financial', adminFinancialRoutes);

// OAuth demo endpoints (for testing)
app.get('/api/oauth/demo/google', (req, res) => {
  // Demo Google OAuth - in production, this would redirect to Google OAuth
  res.json({
    message: 'Google OAuth demo',
    user: {
      id: 'demo-google-user',
      email: 'demo@google.com',
      name: 'Demo Google User'
    }
  });
});

app.get('/api/oauth/demo/facebook', (req, res) => {
  // Demo Facebook OAuth - in production, this would redirect to Facebook OAuth
  res.json({
    message: 'Facebook OAuth demo',
    user: {
      id: 'demo-facebook-user',
      email: 'demo@facebook.com',
      name: 'Demo Facebook User'
    }
  });
});

// Debug route to check database schema (no auth required)
app.get('/api/debug/schema', async (req, res) => {
  try {
    console.log('🔍 Checking production database schema...');
    
    // Check if custom_data column exists in assets table
    const assetsColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'assets' AND column_name = 'custom_data'
    `);
    
    // Check if custom_data column exists in financial_goal table
    const goalsColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'financial_goal' AND column_name = 'custom_data'
    `);
    
    // Check actual data in the tables
    const assetsData = await pool.query(`
      SELECT id, name, custom_data 
      FROM assets 
      WHERE custom_data IS NOT NULL 
      AND custom_data != '{}'::jsonb
      LIMIT 5
    `);
    
    const goalsData = await pool.query(`
      SELECT id, name, custom_data 
      FROM financial_goal 
      WHERE custom_data IS NOT NULL 
      AND custom_data != '{}'::jsonb
      LIMIT 5
    `);
    
    res.json({
      assets_custom_data_column: assetsColumns.rows,
      goals_custom_data_column: goalsColumns.rows,
      assets_with_custom_data: assetsData.rows,
      goals_with_custom_data: goalsData.rows
    });
  } catch (error) {
    console.error('❌ Schema check failed:', error);
    res.status(500).json({ error: 'Schema check failed', details: error.message });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(error.status || 500).json({
    error: isDevelopment ? error.message : 'Internal server error',
    ...(isDevelopment && { stack: error.stack })
  });
});

// Enhanced crash detection and monitoring
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION at:', promise);
  console.error('🚨 Reason:', reason);
  console.error('🚨 Stack:', reason?.stack || 'No stack trace');
  console.error('🚨 Promise:', promise);
  // Don't exit immediately, log and continue
});

process.on('uncaughtException', (error) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', error);
  console.error('🚨 Stack:', error.stack);
  console.error('🚨 Name:', error.name);
  console.error('🚨 Message:', error.message);
  // Exit gracefully
  process.exit(1);
});

// Monitor for process exit
process.on('exit', (code) => {
  console.error(`🚨 Process exiting with code: ${code}`);
});

process.on('SIGTERM', (signal) => {
  console.error(`🚨 Process received SIGTERM: ${signal}`);
});

process.on('SIGINT', (signal) => {
  console.error(`🚨 Process received SIGINT: ${signal}`);
});

// Memory monitoring
setInterval(() => {
  const memUsage = process.memoryUsage();
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);
  console.log(`[MEM] RSS: ${rssMB}MB, Heap: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
  
  // Alert if memory usage is high
  if (rssMB > 500) {
    console.warn(`⚠️  High memory usage: ${rssMB}MB`);
  }
}, 10000); // Every 10 seconds

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n${signal} received; closing server gracefully...`);
  try {
    await pool.end();
    console.log('✅ Database pool closed');
  } catch (error) {
    console.error('❌ Error closing database pool:', error);
  }
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server after schema patches so new mockup columns exist
ensureLifemapMockupSchema(pool)
  .then(async () => {
    await purgeExpiredDeletedItems();
    await runDailyLogArchive();
  })
  .catch((error) => {
    console.error('[migrate] LifeMap mockup schema failed (server will still start):', error.message);
  })
  .finally(() => {
    // Purge soft-deleted items past their 90-day window (skips legal holds) once a day, in addition to boot.
    const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
    const purgeTimer = setInterval(() => {
      purgeExpiredDeletedItems().catch((error) => {
        console.error('[purge] scheduled purge failed:', error.message);
      });
    }, PURGE_INTERVAL_MS);
    purgeTimer.unref?.();

    // CERT-In / DPDP log retention: daily CSV snapshot of activity_log (180 days now; 1 year from May 2027).
    const archiveTimer = setInterval(() => {
      runDailyLogArchive().catch((error) => {
        console.error('[log-archive] scheduled job failed:', error.message);
      });
    }, PURGE_INTERVAL_MS);
    archiveTimer.unref?.();

    app.listen(PORT, () => {
      console.log(`🚀 Life Sheet Backend Server running on port ${PORT}`);
      console.log(`📊 Database: PostgreSQL (${process.env.DB_NAME || 'life_sheet'})`);
      console.log(`🌐 CORS Origin: ${process.env.CORS_ORIGIN || 'http://localhost:5174'}`);
      console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
    });
  });

export default app;
