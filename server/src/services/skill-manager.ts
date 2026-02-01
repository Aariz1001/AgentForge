/**
 * Skill Manager Service
 * 
 * Manages specialized engineering skills and pattern libraries.
 * Loads skill definitions from local and remote sources.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  path: string;
  category?: string;
}

export class SkillManagerService {
  private skills: Map<string, Skill> = new Map();
  private skillPaths: string[] = [];

  constructor(paths: string[] = []) {
    this.skillPaths = paths;
    if (this.skillPaths.length === 0) {
      this.skillPaths = [
        path.join(homedir(), '.copilot', 'skills'),
        path.join(homedir(), '.claude', 'skills')
      ];
    }
  }

  async scanSkills(): Promise<Skill[]> {
    const results: Skill[] = [];

    for (const basePath of this.skillPaths) {
      try {
        if (!existsSync(basePath)) continue;
        
        const dirs = await fs.readdir(basePath);
        for (const dir of dirs) {
          const skillDir = path.join(basePath, dir);
          const skillFile = path.join(skillDir, 'SKILL.md');
          
          if (existsSync(skillFile)) {
            const content = await fs.readFile(skillFile, 'utf-8');
            const titleMatch = content.match(/^#\s+(.*)/m);
            const descMatch = content.match(/^##\s+Description\n([\s\S]*?)\n##/i) || content.match(/^> (.*)/m);
            
            const skill: Skill = {
              id: dir,
              name: titleMatch ? titleMatch[1].trim() : dir,
              description: descMatch ? descMatch[1].trim().split('\n')[0] : 'No description',
              content,
              path: skillFile
            };
            
            this.skills.set(skill.id, skill);
            results.push(skill);
          }
        }
      } catch (error) {
        console.error(`Error scanning skills in ${basePath}:`, error);
      }
    }

    return results;
  }

  async getSkill(id: string): Promise<Skill | null> {
    if (this.skills.has(id)) return this.skills.get(id)!;
    
    // Attempt scan if not found
    await this.scanSkills();
    return this.skills.get(id) || null;
  }
}
