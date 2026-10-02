import type { AccessToken } from "../../../src/domain/connection/AccessToken";
import type { SealedToken, TokenSealing } from "../application/instagramConnecting";

// アクセストークンの暗号化（ADR-0007）。AES-256-GCM・12バイトの乱数 IV・AAD は連携ID。Java の TokenCipher と互換
const IV_BYTES = 12;

export class TokenCipher implements TokenSealing {
  private constructor(private readonly key: CryptoKey, private readonly keyVersion: number) {}

  static async fromBase64Key(base64Key: string, keyVersion: number): Promise<TokenCipher> {
    const raw = fromBase64(base64Key);
    if (raw.length !== 32) throw new Error("トークン暗号鍵は32バイト（base64）です");
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    return new TokenCipher(key, keyVersion);
  }

  async seal(token: AccessToken, connectionId: string, iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))): Promise<SealedToken> {
    const ciphertext = await crypto.subtle.encrypt(this.params(iv, connectionId), this.key, new TextEncoder().encode(token.reveal()));
    return { ciphertextBase64: toBase64(new Uint8Array(ciphertext)), ivBase64: toBase64(iv), keyVersion: this.keyVersion };
  }

  async open(sealed: SealedToken, connectionId: string): Promise<string> {
    const plain = await crypto.subtle.decrypt(this.params(fromBase64(sealed.ivBase64), connectionId), this.key,
      fromBase64(sealed.ciphertextBase64));
    return new TextDecoder().decode(plain);
  }

  private params(iv: Uint8Array, connectionId: string): AesGcmParams {
    return { name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(connectionId), tagLength: 128 };
  }
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
