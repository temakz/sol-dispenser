import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  scryptSync,
} from "node:crypto";

export function requireValue(args, index) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${args[index]} requires a value`);
  }
  return value;
}

export function parseRecipientFlag(value) {
  const separator = value.lastIndexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Recipient must use ADDRESS:SOL format: ${value}`);
  }
  return {
    address: value.slice(0, separator),
    amountSol: value.slice(separator + 1),
  };
}

export function parsePrepareFlags(args) {
  const flags = {
    run: "",
    secretsOnly: false,
    dryRun: false,
    confirm: false,
    confirmMainnet: "",
    confirmTotal: "",
    force: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--run") {
      flags.run = requireValue(args, index);
      index += 1;
    } else if (arg === "--secrets-only") {
      flags.secretsOnly = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--confirm") {
      flags.confirm = true;
    } else if (arg === "--confirm-mainnet") {
      flags.confirmMainnet = requireValue(args, index);
      index += 1;
    } else if (arg === "--confirm-total") {
      flags.confirmTotal = requireValue(args, index);
      index += 1;
    } else if (arg === "--force") {
      flags.force = true;
    } else {
      throw new Error(`Unknown prepare flag: ${arg}`);
    }
  }

  if (!flags.run) {
    throw new Error("prepare requires --run RUN_ID");
  }

  return flags;
}

export function parseExecuteFlags(args) {
  const flags = {
    run: "",
    dryRun: false,
    confirm: false,
    force: false,
    confirmMainnet: "",
    confirmTotal: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--run") {
      flags.run = requireValue(args, index);
      index += 1;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--confirm") {
      flags.confirm = true;
    } else if (arg === "--force") {
      flags.force = true;
    } else if (arg === "--confirm-mainnet") {
      flags.confirmMainnet = requireValue(args, index);
      index += 1;
    } else if (arg === "--confirm-total") {
      flags.confirmTotal = requireValue(args, index);
      index += 1;
    } else {
      throw new Error(`Unknown execute flag: ${arg}`);
    }
  }

  if (!flags.run) {
    throw new Error("execute requires --run RUN_ID");
  }

  return flags;
}

export function validatePlan(plan) {
  if (plan.schemaVersion !== 1) {
    throw new Error("Unsupported plan schema version");
  }
  if (!["localnet", "devnet", "mainnet-beta"].includes(plan.cluster)) {
    throw new Error("Invalid cluster");
  }
  if (!isSolanaPubkey(plan.programId)) {
    throw new Error("Invalid program id");
  }
  if (plan.rescueWallet && !isSolanaPubkey(plan.rescueWallet)) {
    throw new Error("Invalid rescue wallet");
  }
  if (plan.cluster === "mainnet-beta" && !plan.rescueWallet) {
    throw new Error("mainnet-beta plans require an explicit rescue wallet");
  }
  if (plan.walletCount !== plan.recipients.length) {
    throw new Error("walletCount must equal recipients length");
  }
  if (plan.walletCount > 16) {
    throw new Error("walletCount must not exceed on-chain limit of 16");
  }

  const total = BigInt(plan.totalLamports);
  const recipientTotal = plan.recipients.reduce((sum, recipient) => {
    if (!isSolanaPubkey(recipient.address)) {
      throw new Error(`Invalid recipient address: ${recipient.address}`);
    }
    const amount = BigInt(recipient.amountLamports);
    if (amount <= 0n) {
      throw new Error("Recipient amount must be greater than zero");
    }
    return sum + amount;
  }, 0n);

  if (total <= 0n) {
    throw new Error("Total amount must be greater than zero");
  }
  if (recipientTotal !== total) {
    throw new Error("Recipient amounts must sum to total");
  }
}

export function verifySecrets(plan, secrets) {
  if (secrets.schemaVersion !== 1) {
    throw new Error("Unsupported secrets schema version");
  }
  if (secrets.runId !== plan.runId) {
    throw new Error("Secrets runId does not match plan");
  }
  if (!Array.isArray(secrets.accounts) || secrets.accounts.length !== plan.recipients.length) {
    throw new Error("Secrets account count does not match plan");
  }

  for (const account of secrets.accounts) {
    const recipient = plan.recipients[account.index];
    if (!recipient) {
      throw new Error(`Unexpected secret account index: ${account.index}`);
    }
    if (recipient.address !== account.recipient) {
      throw new Error(`Secret recipient mismatch at index ${account.index}`);
    }
    if (recipient.amountLamports !== account.amountLamports) {
      throw new Error(`Secret amount mismatch at index ${account.index}`);
    }

    const disposableSeed = Buffer.from(account.disposableSeed, "base64");
    const nonceSeed = Buffer.from(account.nonceSeed, "base64");
    if (publicKeyFromSeed(disposableSeed) !== account.disposablePublicKey) {
      throw new Error(`Disposable public key mismatch at index ${account.index}`);
    }
    if (publicKeyFromSeed(nonceSeed) !== account.noncePublicKey) {
      throw new Error(`Nonce public key mismatch at index ${account.index}`);
    }
  }
}

export function validateConfig(config) {
  const requiredStrings = [
    "cluster",
    "rpcUrl",
    "sourceWalletPath",
    "rescueWallet",
    "programId",
    "maxSolPerRun",
  ];

  for (const key of requiredStrings) {
    if (typeof config[key] !== "string") {
      throw new Error(`${key} must be a string`);
    }
  }

  if (!["localnet", "devnet", "mainnet-beta"].includes(config.cluster)) {
    throw new Error("cluster must be localnet, devnet, or mainnet-beta");
  }
  validateRpcUrlForCluster(config.rpcUrl, config.cluster);

  if (!isSolanaPubkey(config.programId)) {
    throw new Error("programId must be a Solana public key");
  }

  if (config.rescueWallet && !isSolanaPubkey(config.rescueWallet)) {
    throw new Error("rescueWallet must be empty or a Solana public key");
  }

  if (config.cluster === "mainnet-beta" && !config.rescueWallet) {
    throw new Error("mainnet-beta requires an explicit rescueWallet");
  }

  if (config.requireMainnetTypedConfirmation !== true) {
    throw new Error("requireMainnetTypedConfirmation must be true");
  }

  const maxLamports = parseSolToLamports(config.maxSolPerRun);
  if (maxLamports <= 0n) {
    throw new Error("maxSolPerRun must be greater than zero");
  }
}

export function validateRpcUrlForCluster(rpcUrl, cluster) {
  let url = null;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw new Error("rpcUrl must be a valid URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("rpcUrl must use http or https");
  }

  const target = `${url.hostname}${url.pathname}`.toLowerCase();
  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  const looksDevnet = target.includes("devnet");
  const looksTestnet = target.includes("testnet");
  const looksMainnet = target.includes("mainnet");

  if (cluster === "localnet" && !isLocal) {
    throw new Error("localnet rpcUrl must point to localhost, 127.0.0.1, or ::1");
  }
  if (cluster === "devnet" && (looksMainnet || isLocal)) {
    throw new Error("devnet rpcUrl must not point to mainnet or localnet");
  }
  if (cluster === "mainnet-beta" && (looksDevnet || looksTestnet || isLocal)) {
    throw new Error("mainnet-beta rpcUrl must not point to devnet, testnet, or localnet");
  }
}

export function parseSolToLamports(value) {
  const text = String(value).trim();
  if (!/^[0-9]+(\.[0-9]{1,9})?$/.test(text)) {
    throw new Error(`Invalid SOL amount: ${value}`);
  }

  const [whole, fractional = ""] = text.split(".");
  const lamportsText = `${whole}${fractional.padEnd(9, "0")}`.replace(/^0+(?=\d)/, "");
  return BigInt(lamportsText || "0");
}

export function formatLamports(lamports) {
  const value = BigInt(lamports);
  const whole = value / 1_000_000_000n;
  const fractional = value % 1_000_000_000n;
  const fractionalText = fractional.toString().padStart(9, "0").replace(/0+$/, "");
  return fractionalText ? `${whole}.${fractionalText}` : whole.toString();
}

export function isSolanaPubkey(value) {
  try {
    return decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}

export function decodeBase58(value) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = [];

  for (const char of value) {
    const carryStart = alphabet.indexOf(char);
    if (carryStart < 0) {
      throw new Error("Invalid base58 character");
    }

    let carry = carryStart;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (const char of value) {
    if (char === "1") {
      bytes.push(0);
    } else {
      break;
    }
  }

  return bytes.reverse();
}

export function createRunId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function encryptJson(value, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    schemaVersion: 1,
    cipher: "aes-256-gcm",
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptJson(encrypted, passphrase) {
  const key = scryptSync(passphrase, Buffer.from(encrypted.salt, "base64"), 32);
  const decipher = createDecipheriv(
    encrypted.cipher,
    key,
    Buffer.from(encrypted.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

export function publicKeyFromSeed(seed) {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) {
    throw new Error("Ed25519 seed must be exactly 32 bytes");
  }

  const privateKeyDerPrefix = Buffer.from("302e020100300506032b657004220420", "hex");
  const publicKeyDerPrefixLength = 12;
  const privateKey = createPrivateKey({
    key: Buffer.concat([privateKeyDerPrefix, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey).export({
    format: "der",
    type: "spki",
  });
  return encodeBase58(publicKey.subarray(publicKeyDerPrefixLength));
}

export function encodeBase58(buffer) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];

  for (const byte of buffer) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let result = "";
  for (const byte of buffer) {
    if (byte === 0) {
      result += "1";
    } else {
      break;
    }
  }

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    result += alphabet[digits[index]];
  }

  return result;
}

export function checkedNumberFromLamports(lamports, label) {
  const value = BigInt(lamports);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds JavaScript safe integer range`);
  }
  return Number(value);
}
