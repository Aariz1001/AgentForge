import inquirer from 'inquirer';
import { ToolResult } from '../index';

interface HumanInTheLoopArgs {
  action: 'pause' | 'confirm';
  message?: string;
  instructions?: string;
  allowCancel?: boolean;
}

export async function HumanInTheLoop(args: HumanInTheLoopArgs): Promise<ToolResult> {
  try {
    const {
      action,
      message = 'Manual intervention required.',
      instructions = 'Complete the task in the browser, then confirm to continue.',
      allowCancel = true
    } = args;

    if (!action) {
      return new ToolResult(false, 'action is required for HITL');
    }

    const promptChoices = [
      { name: '✓ Done (continue)', value: 'done' },
      ...(allowCancel ? [{ name: '✗ Cancel (stop)', value: 'cancel' }] : [])
    ];

    console.log('\n' + message);
    console.log(instructions + '\n');

    const answer: any = await inquirer.prompt([
      {
        type: 'list',
        name: 'status',
        message: 'Confirm when complete:',
        choices: promptChoices
      }
    ]);

    if (answer.status === 'cancel') {
      return new ToolResult(false, 'HITL canceled by user', { status: 'cancel' });
    }

    return new ToolResult(true, 'HITL completed by user', { status: 'done' });
  } catch (error: any) {
    return new ToolResult(false, `HITL failed: ${error.message}`);
  }
}

(HumanInTheLoop as any).description = 'Pause for human-in-the-loop actions like captchas, payment details, or manual verification and resume smoothly.';
(HumanInTheLoop as any).parameters = {
  action: { type: 'string', description: 'Action: pause or confirm', required: true, enum: ['pause', 'confirm'] },
  message: { type: 'string', description: 'Short message shown to the user', required: false },
  instructions: { type: 'string', description: 'Detailed instructions for manual steps', required: false },
  allowCancel: { type: 'boolean', description: 'Allow cancel option (default: true)', required: false }
};

export default HumanInTheLoop;
