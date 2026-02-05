export type ResourceHandleType = 'mcp' | 'browser' | 'generic';

export interface ResourceHandle {
  id: string;
  type: ResourceHandleType;
  startedAt: number;
  timeoutMs: number;
  abort?: () => void;
}

export class ResourceGuardService {
  private handles: Map<string, ResourceHandle> = new Map();

  register(handle: ResourceHandle): void {
    this.handles.set(handle.id, handle);
  }

  release(handleId: string): void {
    this.handles.delete(handleId);
  }

  purgeOrphans(graceMs: number = 0): number {
    const now = Date.now();
    let purged = 0;
    for (const [id, handle] of this.handles.entries()) {
      if (now - handle.startedAt > handle.timeoutMs + graceMs) {
        try {
          handle.abort?.();
        } finally {
          this.handles.delete(id);
          purged += 1;
        }
      }
    }
    return purged;
  }
}
