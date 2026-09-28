import { Router, Request, Response } from 'express';
import os from 'os';
import { getIO } from '../utils/socketService';

const router = Router();

// In-memory signature sessions store for real-time mobile sync
interface SignatureSession {
  signature: string;
  guestName: string;
  timestamp: number;
}

const signatureSessions = new Map<string, SignatureSession>();

function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('127.')) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

// GET /api/signature-sync or /api/v1/signature-sync
router.get('/', (req: Request, res: Response) => {
  const { action, session } = req.query;

  if (action === 'network-info') {
    const localIp = getLocalIpAddress();
    const adminPort = 3001;
    return res.json({
      localIp,
      port: adminPort,
      fullUrl: `http://${localIp}:${adminPort}`,
    });
  }

  const sessionId = typeof session === 'string' ? session : '';
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  const data = signatureSessions.get(sessionId);
  if (!data) {
    return res.json({ status: 'PENDING', signature: null });
  }

  return res.json({
    status: data.signature ? 'SIGNED' : 'PENDING',
    signature: data.signature || null,
    timestamp: data.timestamp,
    guestName: data.guestName || '',
  });
});

// POST /api/signature-sync or /api/v1/signature-sync
router.post('/', (req: Request, res: Response) => {
  try {
    const { sessionId, signature, guestName } = req.body;

    if (!sessionId || !signature) {
      return res.status(400).json({ error: 'Session ID and signature data required' });
    }

    const payload: SignatureSession = {
      signature,
      guestName: guestName || 'Guest',
      timestamp: Date.now(),
    };

    signatureSessions.set(sessionId, payload);

    // Broadcast via WebSockets for zero-latency instant sync
    const io = getIO();
    if (io) {
      const room = `sig_${sessionId}`;
      io.to(room).emit('SIGNATURE_SUBMITTED', {
        sessionId,
        signature,
        guestName: payload.guestName,
      });
      io.emit('SIGNATURE_SUBMITTED', {
        sessionId,
        signature,
        guestName: payload.guestName,
      });
      console.log(`⚡ [SignatureSync] Broadcasted signature for session: ${sessionId}`);
    }

    // Cleanup sessions older than 30 mins
    const now = Date.now();
    for (const [id, s] of signatureSessions.entries()) {
      if (now - s.timestamp > 30 * 60 * 1000) {
        signatureSessions.delete(id);
      }
    }

    return res.json({ success: true, message: 'Signature synced successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to sync signature' });
  }
});

export default router;
