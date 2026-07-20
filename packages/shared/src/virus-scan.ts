import 'server-only';

export interface VirusScanResult {
  clean: boolean;
  reason?: string;
}

/**
 * Placeholder for a real malware scanner (e.g. ClamAV, a hosted scanning
 * API). The no-op default always reports clean — this satisfies "virus scan
 * interface placeholder," not a real scan. Wire up a real implementation
 * before trusting it in production.
 */
export interface VirusScanner {
  scan(buffer: Buffer, fileName: string): Promise<VirusScanResult>;
}

class NoopVirusScanner implements VirusScanner {
  async scan(): Promise<VirusScanResult> {
    return { clean: true };
  }
}

let instance: VirusScanner | undefined;

export function getVirusScanner(): VirusScanner {
  if (!instance) {
    instance = new NoopVirusScanner();
  }
  return instance;
}
