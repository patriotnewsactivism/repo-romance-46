/**
 * KMS-backed envelope encryption for sensitive credentials (e.g. GitHub tokens).
 * Uses Google Cloud KMS for data key encryption; application never holds the master key.
 */
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const kmsClient = new KeyManagementServiceClient();

export interface Envelope {
  encryptedDataKey: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
  keyVersion?: string;
}

export async function encryptCredential(
  plaintext: string,
  kmsKeyName: string = process.env.KMS_KEY_NAME || ''
): Promise<Envelope> {
  if (!kmsKeyName) {
    throw new Error('KMS_KEY_NAME is required for envelope encryption');
  }

  // Generate a random data encryption key (DEK)
  const dek = randomBytes(32);
  const iv = randomBytes(12);

  // Encrypt plaintext with DEK (AES-256-GCM)
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Encrypt the DEK with KMS
  const [kmsResult] = await kmsClient.encrypt({
    name: kmsKeyName,
    plaintext: dek,
  });

  return {
    encryptedDataKey: Buffer.from(kmsResult.ciphertext as Uint8Array).toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: Buffer.concat([encrypted, authTag]).toString('base64'),
  };
}

export async function decryptCredential(
  envelope: Envelope,
  kmsKeyName: string = process.env.KMS_KEY_NAME || ''
): Promise<string> {
  if (!kmsKeyName) {
    throw new Error('KMS_KEY_NAME is required for envelope decryption');
  }

  // Decrypt DEK with KMS (handles key versioning automatically)
  const [kmsResult] = await kmsClient.decrypt({
    name: kmsKeyName,
    ciphertext: Buffer.from(envelope.encryptedDataKey, 'base64'),
  });

  const dek = Buffer.from(kmsResult.plaintext as Uint8Array);
  const iv = Buffer.from(envelope.iv, 'base64');
  const data = Buffer.from(envelope.ciphertext, 'base64');
  const authTag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(0, data.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
