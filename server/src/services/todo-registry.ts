import { v4 as uuidv4 } from 'uuid';

export interface TodoItem {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'done';
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export class TodoRegistry {
  private items: Map<string, TodoItem> = new Map();
  private maxItems: number;

  constructor(options: { maxItems: number }) {
    this.maxItems = options.maxItems;
  }

  add(title: string, tags?: string[]): TodoItem {
    const now = new Date().toISOString();
    const item: TodoItem = {
      id: uuidv4(),
      title,
      status: 'open',
      tags,
      createdAt: now,
      updatedAt: now
    };
    this.items.set(item.id, item);
    this.pruneOverflow();
    return item;
  }

  update(id: string, updates: Partial<Pick<TodoItem, 'title' | 'status' | 'tags'>>): TodoItem | null {
    const existing = this.items.get(id);
    if (!existing) return null;
    const updated: TodoItem = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.items.set(id, updated);
    return updated;
  }

  list(): TodoItem[] {
    return Array.from(this.items.values());
  }

  private pruneOverflow(): void {
    if (this.items.size <= this.maxItems) return;
    const sorted = Array.from(this.items.values())
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const overflow = sorted.length - this.maxItems;
    for (let i = 0; i < overflow; i++) {
      this.items.delete(sorted[i].id);
    }
  }
}
