import mongoose, { Schema, Decimal128, Model } from 'mongoose';

import { IVaultDocument, IVaultSchema } from '../types/vault';
import { EventData, IEvent, VaultEventTypes } from '../types/event';
import {
  BurnZkUsdEvent,
  DepositCollateralEvent,
  LiquidateEvent,
  MintZkUsdEvent,
  NewVaultEvent,
  RedeemCollateralEvent,
  VaultOwnerUpdatedEvent,
} from 'zkusd';

/**
 * Mongoose model for tracking zkUSD vault states.
 * Maintains the current state of each vault including:
 * - Collateral amounts
 * - Debt amounts
 * - Ownership information
 * - Update history
 */
const VaultSchema = new Schema<IVaultDocument>(
  {
    // Unique identifier for the vault
    address: { type: String, required: true, unique: true },
    // Current owner's public key
    owner: { type: String, required: true },
    // Amount of collateral locked in the vault
    collateralAmount: { type: Schema.Types.Decimal128, required: true },
    // Amount of zkUSD debt issued against the collateral
    debtAmount: { type: Schema.Types.Decimal128, required: true },
    // Block number of the last update
    lastUpdateBlock: { type: Number, required: true },
    // Timestamp of the last update
    lastUpdateTimestamp: { type: Date, required: true },
    // Transaction hash of the latest modification
    latestTransactionHash: { type: String, required: true },
  },
  {
    timestamps: true,
    collection: 'vaults',
  }
);

/**
 * Extended model interface with custom static methods
 */
interface IVaultModel extends Model<IVaultDocument> {
  updateFromEvent(event: IEvent): Promise<Boolean>;
}

/**
 * Updates vault state based on on-chain events.
 * Handles various event types:
 * - Vault creation
 * - Owner updates
 * - Collateral deposits/withdrawals
 * - Debt minting/burning
 * - Liquidations
 */
VaultSchema.statics.updateFromEvent = async function (
  event: IEvent
): Promise<Boolean> {
  const eventData: EventData = event.event.data;
  const transactionHash = event.event.transactionInfo.transactionHash;

  const vaultAddress = eventData.vaultAddress.toBase58();

  const existingVault = await this.findOne({ address: vaultAddress });
  if (
    existingVault &&
    existingVault.latestTransactionHash === transactionHash
  ) {
    return false;
  }

  const updateData: Partial<IVaultDocument> = {
    lastUpdateBlock: Number(event.blockHeight),
    lastUpdateTimestamp: new Date(),
    latestTransactionHash: transactionHash,
  };

  function addUpdateData(
    eventData:
      | DepositCollateralEvent
      | RedeemCollateralEvent
      | MintZkUsdEvent
      | BurnZkUsdEvent
  ) {
    updateData.collateralAmount = new mongoose.Types.Decimal128(
      eventData.vaultCollateralAmount.toString()
    );
    updateData.debtAmount = new mongoose.Types.Decimal128(
      eventData.vaultDebtAmount.toString()
    );
  }

  switch (event.type) {
    case VaultEventTypes.NEW_VAULT:
      updateData.collateralAmount = new mongoose.Types.Decimal128('0');
      updateData.debtAmount = new mongoose.Types.Decimal128('0');
      updateData.owner = (eventData as NewVaultEvent).owner.toBase58();
      break;
    case VaultEventTypes.VAULT_OWNER_UPDATED:
      updateData.owner = (
        eventData as VaultOwnerUpdatedEvent
      ).newOwner.toBase58();
      break;
    case VaultEventTypes.DEPOSIT_COLLATERAL:
      addUpdateData(eventData as DepositCollateralEvent);
      break;
    case VaultEventTypes.REDEEM_COLLATERAL:
      addUpdateData(eventData as RedeemCollateralEvent);
      break;
    case VaultEventTypes.MINT_ZKUSD:
      addUpdateData(eventData as MintZkUsdEvent);
      break;
    case VaultEventTypes.BURN_ZKUSD:
      addUpdateData(eventData as BurnZkUsdEvent);
      break;
    case VaultEventTypes.LIQUIDATE:
      updateData.collateralAmount = new mongoose.Types.Decimal128('0');
      updateData.debtAmount = new mongoose.Types.Decimal128('0');
      break;
  }

  await this.findOneAndUpdate({ address: vaultAddress }, updateData, {
    upsert: true,
    new: true,
  });
  return true;
};

export const VaultModel = mongoose.model<IVaultDocument, IVaultModel>(
  'Vault',
  VaultSchema
);
