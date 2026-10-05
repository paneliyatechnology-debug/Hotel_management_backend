import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

let io: Server | null = null;

export interface ConnectedUserSession {
  socketId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  hotelId: string | null;
  connectedAt: number;
}

// Global active presence session map: socket.id -> ConnectedUserSession
const activeSessions = new Map<string, ConnectedUserSession>();

export const getOnlineUserIds = (hotelId?: string): string[] => {
  const ids = new Set<string>();
  for (const session of activeSessions.values()) {
    if (!hotelId || session.hotelId === hotelId) {
      if (session.userId) ids.add(session.userId.toString());
    }
  }
  return Array.from(ids);
};

export const getOnlineHotelIds = (): string[] => {
  const hotelIds = new Set<string>();
  for (const session of activeSessions.values()) {
    if (session.hotelId) hotelIds.add(session.hotelId.toString());
  }
  return Array.from(hotelIds);
};

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

  // Start periodic presence sync broadcast (every 3 seconds)
  if (!(global as any).__presenceIntervalStarted) {
    (global as any).__presenceIntervalStarted = true;
    setInterval(() => {
      if (io) {
        const onlineHotelIds = getOnlineHotelIds();
        const onlineUserIds = getOnlineUserIds();
        io.emit('PRESENCE_SYNC', {
          onlineHotelIds,
          onlineUserIds,
          onlineCount: activeSessions.size,
        });
      }
    }, 3000);
  }

  io.on('connection', (socket: Socket) => {
    console.log(`🔌 [Socket.io] Client connected: ${socket.id}`);

    // Helper to register user session
    const registerPresence = (data: {
      userId?: string;
      name?: string;
      email?: string;
      role?: string;
      hotelId?: string;
      token?: string;
    }) => {
      let targetUserId = data?.userId;
      let targetHotelId = data?.hotelId;
      let targetName = data?.name;
      let targetEmail = data?.email;
      let targetRole = data?.role;

      if (data?.token && (!targetUserId || !targetHotelId)) {
        try {
          const secret = process.env.JWT_SECRET || 'super_hotel_jwt_secret_key_2026_modern_secure';
          const decoded: any = jwt.verify(data.token, secret);
          targetUserId = targetUserId || decoded?.id || decoded?._id;
          targetHotelId = targetHotelId || decoded?.hotel || decoded?.hotelId;
          targetRole = targetRole || decoded?.role;
        } catch {
          // Token decode fallback
        }
      }

      if (targetUserId) {
        const uIdStr = targetUserId.toString();
        const hIdStr = targetHotelId ? targetHotelId.toString() : null;

        activeSessions.set(socket.id, {
          socketId: socket.id,
          userId: uIdStr,
          name: targetName || 'Staff Member',
          email: targetEmail || '',
          role: targetRole || 'STAFF',
          hotelId: hIdStr,
          connectedAt: Date.now(),
        });

        const currentOnlineHotelIds = getOnlineHotelIds();
        const currentOnlineUserIds = getOnlineUserIds(hIdStr || undefined);

        // Send instant current presence state to the connecting client
        socket.emit('ONLINE_PRESENCE_STATE', {
          onlineUserIds: currentOnlineUserIds,
          onlineHotelIds: currentOnlineHotelIds,
        });

        // Broadcast USER_ONLINE to hotel room
        if (hIdStr) {
          io?.to(`hotel_${hIdStr}`).emit('USER_ONLINE', {
            userId: uIdStr,
            name: targetName,
            email: targetEmail,
            role: targetRole,
            hotelId: hIdStr,
            onlineUserIds: currentOnlineUserIds,
          });

          // Broadcast HOTEL_ONLINE to all clients (including Super Admin)
          io?.emit('HOTEL_ONLINE', {
            hotelId: hIdStr,
            onlineHotelIds: currentOnlineHotelIds,
          });
        }

        // Broadcast to Super Admin
        io?.to('super_admin_room').emit('USER_ONLINE', {
          userId: uIdStr,
          name: targetName,
          email: targetEmail,
          role: targetRole,
          hotelId: hIdStr,
          onlineHotelIds: currentOnlineHotelIds,
        });

        // Global presence event
        io?.emit('PRESENCE_SYNC', {
          onlineHotelIds: currentOnlineHotelIds,
          onlineUserIds: getOnlineUserIds(),
          onlineCount: activeSessions.size,
        });
      }
    };

    // 1. Hotel Room Registration & Presence
    socket.on('join_hotel', (data: { hotelId?: any; token?: string; user?: any }) => {
      let rawHotelId = data?.hotelId || data?.user?.hotel?._id || data?.user?.hotel;

      if (!rawHotelId && data?.token) {
        try {
          const secret = process.env.JWT_SECRET || 'super_hotel_jwt_secret_key_2026_modern_secure';
          const decoded: any = jwt.verify(data.token, secret);
          rawHotelId = decoded?.hotel || decoded?.hotelId;
        } catch {
          // Token decode fallback
        }
      }

      if (rawHotelId) {
        const hIdStr = (rawHotelId._id || rawHotelId.id || rawHotelId).toString();
        const roomName = `hotel_${hIdStr}`;
        socket.join(roomName);
        console.log(`🏨 [Socket.io] Socket ${socket.id} joined room: ${roomName}`);
        socket.emit('joined_room', { room: roomName, success: true, timestamp: Date.now() });

        registerPresence({
          userId: data?.user?._id || data?.user?.id || socket.id,
          name: data?.user?.name || 'Hotel Staff',
          email: data?.user?.email || '',
          role: data?.user?.role || 'HOTEL_ADMIN',
          hotelId: hIdStr,
          token: data?.token,
        });
      }
    });

    // 2. Super Admin Global Management Room & Presence
    socket.on('join_super_admin', (data?: { user?: any; token?: string }) => {
      socket.join('super_admin_room');
      console.log(`👑 [Socket.io] Socket ${socket.id} joined super_admin_room`);
      socket.emit('joined_room', { room: 'super_admin_room', success: true });

      // Send initial presence state to Super Admin
      socket.emit('ONLINE_PRESENCE_STATE', {
        onlineUserIds: getOnlineUserIds(),
        onlineHotelIds: getOnlineHotelIds(),
      });

      if (data?.user) {
        registerPresence({
          userId: data.user._id || data.user.id,
          name: data.user.name,
          email: data.user.email,
          role: 'SUPER_ADMIN',
          token: data.token,
        });
      }
    });

    // 3. Explicit User Presence Registration & Heartbeat
    socket.on('user_presence', (data: {
      userId?: string;
      name?: string;
      email?: string;
      role?: string;
      hotelId?: string;
      token?: string;
    }) => {
      registerPresence(data);
    });

    // 4. Request presence state on demand
    socket.on('get_presence', (data?: { hotelId?: string }) => {
      socket.emit('ONLINE_PRESENCE_STATE', {
        onlineUserIds: getOnlineUserIds(data?.hotelId),
        onlineHotelIds: getOnlineHotelIds(),
      });
    });

    // 5. Customer Public Hotel Live Room (for room availability on website)
    socket.on('join_public_hotel', (data: { hotelId: string }) => {
      if (data?.hotelId) {
        socket.join(`public_hotel_${data.hotelId}`);
        console.log(`🌐 [Socket.io] Socket ${socket.id} joined public_hotel_${data.hotelId}`);
      }
    });

    // 6. Real-time Digital Signature Sync Rooms (Zero-polling)
    socket.on('join_signature_session', (data: { sessionId?: string }) => {
      if (data?.sessionId) {
        const room = `sig_${data.sessionId}`;
        socket.join(room);
        console.log(`✍️ [Socket.io] Socket ${socket.id} joined signature session: ${room}`);
      }
    });

    socket.on('submit_signature', (data: { sessionId: string; signature: string; guestName?: string }) => {
      if (data?.sessionId && data?.signature) {
        const room = `sig_${data.sessionId}`;
        console.log(`⚡ [Socket.io] Signature submitted for session: ${data.sessionId}`);
        io?.to(room).emit('SIGNATURE_SUBMITTED', data);
        io?.emit('SIGNATURE_SUBMITTED', data); // Broadcast to any active admin listener
      }
    });

    // 7. Disconnect Handler -> Update Live Presence
    socket.on('disconnect', (reason) => {
      console.log(`❌ [Socket.io] Client disconnected: ${socket.id} (Reason: ${reason})`);
      const session = activeSessions.get(socket.id);
      if (session) {
        activeSessions.delete(socket.id);
        const remainingSocketsForUser = Array.from(activeSessions.values()).some((s) => s.userId === session.userId);
        const remainingSocketsForHotel = session.hotelId
          ? Array.from(activeSessions.values()).some((s) => s.hotelId === session.hotelId)
          : false;

        const currentOnlineHotelIds = getOnlineHotelIds();
        const currentOnlineUserIds = getOnlineUserIds();

        if (!remainingSocketsForUser) {
          if (session.hotelId) {
            io?.to(`hotel_${session.hotelId}`).emit('USER_OFFLINE', {
              userId: session.userId,
              name: session.name,
              hotelId: session.hotelId,
              role: session.role,
              onlineUserIds: getOnlineUserIds(session.hotelId),
            });
          }

          io?.to('super_admin_room').emit('USER_OFFLINE', {
            userId: session.userId,
            name: session.name,
            hotelId: session.hotelId,
            role: session.role,
            onlineHotelIds: currentOnlineHotelIds,
          });
        }

        if (!remainingSocketsForHotel && session.hotelId) {
          io?.emit('HOTEL_OFFLINE', {
            hotelId: session.hotelId,
            onlineHotelIds: currentOnlineHotelIds,
          });
        }

        io?.emit('PRESENCE_SYNC', {
          onlineHotelIds: currentOnlineHotelIds,
          onlineUserIds: currentOnlineUserIds,
          onlineCount: activeSessions.size,
        });
      }
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
