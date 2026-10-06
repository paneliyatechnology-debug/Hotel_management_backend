import { Queue } from 'bullmq';
import { createRedisConnection, isRedisReachable } from '../config/redis';
import {
  EmailJobType,
  EmailJobData,
  EMAIL_QUEUE_NAME,
  processEmailJob,
} from '../workers/emailWorker';
import { maskEmail } from '../services/emailService';

let bullQueue: Queue<EmailJobData> | null = null;
let queueMode: 'REDIS' | 'IN_MEMORY' | 'UNDETERMINED' = 'UNDETERMINED';

// =========================================================================
// IN-MEMORY RESILIENT ASYNC FALLBACK QUEUE (When Redis is not running locally)
// =========================================================================
interface MemoryTask {
  id: string;
  job: EmailJobData;
  attempts: number;
  maxAttempts: number;
  nextRunAt: number;
}

const memoryQueue: MemoryTask[] = [];
let isProcessingMemoryQueue = false;

const runMemoryQueueWorker = async () => {
  if (isProcessingMemoryQueue) return;
  isProcessingMemoryQueue = true;

  try {
    const now = Date.now();
    const readyTasks = memoryQueue.filter((t) => t.nextRunAt <= now);

    for (const task of readyTasks) {
      // Remove from queue for processing
      const index = memoryQueue.indexOf(task);
      if (index !== -1) {
        memoryQueue.splice(index, 1);
      }

      task.attempts += 1;
      try {
        console.log(`⏳ [InMemoryQueue] Processing job ${task.id} (Type: ${task.job.type}, To: ${maskEmail(task.job.to)})`);
        await processEmailJob(task.job);
        console.log(`✅ [InMemoryQueue] Job ${task.id} completed successfully (Type: ${task.job.type})`);
      } catch (err: any) {
        const isNonRetryable = err?.message?.includes('Non-retryable');
        if (!isNonRetryable && task.attempts < task.maxAttempts) {
          const delayMs = task.attempts * 5000;
          task.nextRunAt = Date.now() + delayMs;
          memoryQueue.push(task);
          console.warn(`🔄 [InMemoryQueue] Job ${task.id} failed (Attempt ${task.attempts}/${task.maxAttempts}). Retrying in ${delayMs / 1000}s... Reason: ${err.message}`);
        } else {
          console.error(`❌ [InMemoryQueue] Job ${task.id} PERMANENTLY failed after ${task.attempts} attempts. Reason: ${err.message}`);
        }
      }
    }
  } finally {
    isProcessingMemoryQueue = false;
    // If pending tasks remain, schedule next check
    if (memoryQueue.length > 0) {
      setTimeout(runMemoryQueueWorker, 2000);
    }
  }
};

const enqueueInMemory = (jobData: EmailJobData): void => {
  const task: MemoryTask = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    job: jobData,
    attempts: 0,
    maxAttempts: 3,
    nextRunAt: Date.now(),
  };
  memoryQueue.push(task);
  console.log(`📥 [InMemoryQueue] Job queued: id=${task.id}, type=${jobData.type}, to=${maskEmail(jobData.to)}`);
  setImmediate(runMemoryQueueWorker);
};

// =========================================================================
// BULLMQ INITIALIZATION
// =========================================================================
const getBullQueue = (): Queue<EmailJobData> => {
  if (!bullQueue) {
    const connection = createRedisConnection();
    bullQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5s, 10s, 20s
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });

    bullQueue.on('error', (err: any) => {
      if (err?.code !== 'ECONNREFUSED') {
        console.warn('⚠️ [BullQueue] Queue error:', err?.message || err);
      }
    });
  }
  return bullQueue;
};

/**
 * Determine which queue driver to use (BullMQ + Redis or Resilient In-Memory Queue)
 */
export const initializeEmailQueue = async (): Promise<'REDIS' | 'IN_MEMORY'> => {
  const redisOnline = await isRedisReachable();
  if (redisOnline) {
    queueMode = 'REDIS';
    getBullQueue();
    console.log('🚀 [EmailQueue] BullMQ + Redis queue engine initialized.');
  } else {
    queueMode = 'IN_MEMORY';
    console.log('ℹ️ [EmailQueue] Redis is offline. Running Resilient In-Memory Async Queue mode.');
  }
  return queueMode;
};

/**
 * High-Performance Non-Blocking Job Dispatcher
 * Dispatches an email job immediately in < 10ms without blocking HTTP execution.
 */
export const queueEmail = async (
  type: EmailJobType,
  to: string,
  data: Record<string, any>
): Promise<void> => {
  const recipient = to?.trim();
  if (!recipient) {
    console.warn('⚠️ [EmailQueue] Skipped queuing: No recipient provided.');
    return;
  }

  const jobData: EmailJobData = {
    type,
    to: recipient,
    data,
    createdAt: new Date().toISOString(),
  };

  // Determine mode if not yet initialized
  if (queueMode === 'UNDETERMINED') {
    await initializeEmailQueue();
  }

  if (queueMode === 'REDIS') {
    try {
      const q = getBullQueue();
      const job = await q.add(type, jobData);
      console.log(`📥 [EmailQueue] BullMQ job queued: id=${job.id}, type=${type}, to=${maskEmail(recipient)}`);
      return;
    } catch (redisErr: any) {
      console.warn(`⚠️ [EmailQueue] BullMQ add failed (${redisErr?.message}), falling back to in-memory queue.`);
      queueMode = 'IN_MEMORY';
      enqueueInMemory(jobData);
      return;
    }
  }

  // In-Memory Mode
  enqueueInMemory(jobData);
};

export const getEmailQueueStatus = () => {
  return {
    mode: queueMode,
    inMemoryPendingCount: memoryQueue.length,
  };
};

export default {
  queueEmail,
  initializeEmailQueue,
  getEmailQueueStatus,
};
