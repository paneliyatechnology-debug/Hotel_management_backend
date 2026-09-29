import { Request, Response } from 'express';
import SystemSettings from '../models/SystemSettings';

export const getSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = await SystemSettings.create({ freeTrialValue: 30, freeTrialUnit: 'days' });
    }
    res.status(200).json({ success: true, settings });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { freeTrialValue, freeTrialUnit } = req.body;
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = new SystemSettings();
    }
    if (freeTrialValue !== undefined) settings.freeTrialValue = Number(freeTrialValue);
    if (freeTrialUnit) settings.freeTrialUnit = freeTrialUnit;
    
    await settings.save();
    res.status(200).json({ success: true, settings, message: 'Settings updated successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
