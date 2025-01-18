import fs from 'fs/promises';
import path from 'path';
import { StoredProof } from '../types';

export class DatabaseService {
  private filePath: string;

  constructor() {
    // Store the JSON file in a data directory within the project
    this.filePath = path.join(process.cwd(), 'data', 'proofs.json');
  }

  async init(): Promise<void> {
    try {
      // Ensure the data directory exists
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });

      // Create the file if it doesn't exist
      try {
        await fs.access(this.filePath);
      } catch {
        await fs.writeFile(this.filePath, JSON.stringify([]));
      }
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw new Error('Database initialization failed');
    }
  }

  async getLatestProof(): Promise<StoredProof | null> {
    try {
      const proofs = await this.readProofs();
      if (proofs.length === 0) return null;
      return proofs[proofs.length - 1];
    } catch (error) {
      console.error('Failed to get latest proof:', error);
      throw new Error('Failed to get latest proof');
    }
  }

  async getProofById(id: string): Promise<StoredProof | null> {
    try {
      const proofs = await this.readProofs();
      return proofs.find((p) => p.id === id) || null;
    } catch (error) {
      console.error('Failed to get proof by id:', error);
      throw new Error('Failed to get proof by id');
    }
  }

  async saveProof(proof: StoredProof): Promise<void> {
    try {
      const proofs = await this.readProofs();
      proofs.push(proof);
      await this.writeProofs(proofs);
    } catch (error) {
      console.error('Failed to save proof:', error);
      throw new Error('Failed to save proof');
    }
  }

  private async readProofs(): Promise<StoredProof[]> {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to read proofs:', error);
      throw new Error('Failed to read proofs');
    }
  }

  private async writeProofs(proofs: StoredProof[]): Promise<void> {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(proofs, null, 2));
    } catch (error) {
      console.error('Failed to write proofs:', error);
      throw new Error('Failed to write proofs');
    }
  }

  // Optional: Method to clear all proofs (useful for testing)
  async clearProofs(): Promise<void> {
    try {
      await this.writeProofs([]);
    } catch (error) {
      console.error('Failed to clear proofs:', error);
      throw new Error('Failed to clear proofs');
    }
  }
}

export const database = new DatabaseService();
