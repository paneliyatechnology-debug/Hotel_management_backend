import express from 'express';
import cron from 'node-cron';
import { cleanFolioPdfs } from '../controllers/cronController';

const router = express.Router();

// ⏰ Cron Schedule: Run every 3 hours ('0 */3 * * *')
cron.schedule('0 */3 * * *', () => {
  console.log(`⏰ [Cron] Running 3-hour scheduled job to remove folio PDFs...`);
  cleanFolioPdfs();
});

// Route to manually trigger or test removing folio PDFs
router.get('/clean-folios', cleanFolioPdfs);
router.delete('/clean-folios', cleanFolioPdfs);

export default router;
