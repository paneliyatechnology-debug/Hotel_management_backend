import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

let io: Server | null = null;

export const initSocket = (httpServer: HttpServer): Server => {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Universal origin reflection for local, vercel, network IPs
        callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket: Socket) => {
    console.log(`🔌 [Socket.io] Client connected: ${socket.id}`);

    // 1. Hotel Room Registration
    socket.on('join_hotel', (data: { hotelId?: string; token?: string }) => {
      let targetHotelId = data?.hotelId;

      if (!targetHotelId && data?.token) {
        try {
          const secret = process.env.JWT_SECRET || 'super_hotel_jwt_secret_key_2026_modern_secure';
          const decoded: any = jwt.verify(data.token, secret);
          targetHotelId = decoded?.hotel || decoded?.hotelId;
        } catch {
          // Token decode fallback
        }
      }

      if (targetHotelId) {
        const roomName = `hotel_${targetHotelId}`;
        socket.join(roomName);
        console.log(`🏨 [Socket.io] Socket ${socket.id} joined room: ${roomName}`);
        socket.emit('joined_room', { room: roomName, success: true, timestamp: Date.now() });
      }
    });

    // 2. Super Admin Global Management Room
    socket.on('join_super_admin', () => {
      socket.join('super_admin_room');
      console.log(`👑 [Socket.io] Socket ${socket.id} joined super_admin_room`);
      socket.emit('joined_room', { room: 'super_admin_room', success: true });
    });

    // 3. Customer Public Hotel Live Room (for room availability on website)
    socket.on('join_public_hotel', (data: { hotelId: string }) => {
      if (data?.hotelId) {
        socket.join(`public_hotel_${data.hotelId}`);
        console.log(`🌐 [Socket.io] Socket ${socket.id} joined public_hotel_${data.hotelId}`);
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`❌ [Socket.io] Client disconnected: ${socket.id} (Reason: ${reason})`);
    });
  });

  return io;
};

export const getIO = (): Server | null => {
  return io;
};

/**
 * Emit an event to all staff / admins connected to a specific hotel
 */
export const emitToHotel = (hotelId: string | any, event: string, payload: any = {}): void => {
  if (!io || !hotelId) return;
  const hIdStr = hotelId._id ? hotelId._id.toString() : hotelId.toString();
  console.log(`⚡ [Socket.io] Emitting '${event}' to hotel_${hIdStr}`);
  io.to(`hotel_${hIdStr}`).emit(event, { ...payload, hotelId: hIdStr, timestamp: Date.now() });
  // Also notify public website viewers if room availability changes
  io.to(`public_hotel_${hIdStr}`).emit(event, { ...payload, hotelId: hIdStr, timestamp: Date.now() });
};

/**
 * Emit an event to Super Admin dashboard
 */
export const emitToSuperAdmin = (event: string, payload: any = {}): void => {
  if (!io) return;
  console.log(`⚡ [Socket.io] Emitting '${event}' to super_admin_room`);
  io.to('super_admin_room').emit(event, { ...payload, timestamp: Date.now() });
};

/**
 * Global broadcast to all connected clients
 */
export const emitGlobal = (event: string, payload: any = {}): void => {
  if (!io) return;
  console.log(`⚡ [Socket.io] Global broadcast '${event}'`);
  io.emit(event, { ...payload, timestamp: Date.now() });
};
