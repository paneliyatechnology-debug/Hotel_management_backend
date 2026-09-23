import 'dotenv/config'; // 🚀 Load Environment Variables Immediately
import http from 'http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import connectDB from './config/db';
import { initSocket } from './utils/socketService';

// Route Imports
import authRoutes from './routes/authRoutes';
import hotelRoutes from './routes/hotelRoutes';
import superAdminRoutes from './routes/superAdminRoutes';
import hotelAdminRoutes from './routes/hotelAdminRoutes';
import receptionistRoutes from './routes/receptionistRoutes';
import subscriptionPlanRoutes from './routes/subscriptionPlanRoutes';

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();
const httpServer = http.createServer(app);

// Initialize Real-Time WebSockets
initSocket(httpServer);

// Universal CORS Configuration (Allows Vercel, Localhost, Render, Network IPs & Custom Domains)
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman, server-to-server) or any client origin
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Set-Cookie'],
  })
);

// Explicit preflight handler for all routes
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Mount API Endpoints
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/hotels', hotelRoutes);
app.use('/api/v1/subscription-plans', subscriptionPlanRoutes);
app.use('/api/v1/super-admin', superAdminRoutes);
app.use('/api/v1/admin', hotelAdminRoutes);
app.use('/api/v1/receptionist', receptionistRoutes);

// Health Check & Documentation Overview
app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'success',
    name: 'Multi-Tenant Hotel Management SaaS API',
    version: '1.0.0',
    realTime: 'Socket.io Active',
    modules: {
      auth: '/api/v1/auth',
      publicHotels: '/api/v1/hotels',
      superAdmin: '/api/v1/super-admin',
      hotelAdmin: '/api/v1/admin',
      receptionist: '/api/v1/receptionist',
    },
    timestamp: new Date().toISOString(),
  });
});

const PORT: string | number = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Multi-Tenant Hotel Management Server & Socket.io running on port ${PORT}`);
});
