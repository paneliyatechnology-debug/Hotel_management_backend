import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import connectDB from './config/db';

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

// Middlewares
app.use(
  cors({
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
  })
);
app.use(express.json());
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

app.listen(PORT, () => {
  console.log(`🚀 Multi-Tenant Hotel Management Server running on port ${PORT}`);
});
