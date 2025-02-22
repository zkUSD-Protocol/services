import { Model } from 'mongoose';

export interface IBlockTrackerSchema {
  lastProcessedBlock: number;
  lastProcessedAt: Date;
  isProcessing: boolean;
  lastError?: string;
  startBlock: number;
}

export interface IBlockTrackerDocument extends Document, IBlockTrackerSchema {}
