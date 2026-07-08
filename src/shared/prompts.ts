import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

let promptInterface: ReturnType<typeof createInterface> | undefined;
let promptIterator: AsyncIterableIterator<string> | undefined;

function prompts() {
  promptInterface ||= createInterface({ input, output });
  return promptInterface;
}

function promptLines() {
  promptIterator ||= prompts()[Symbol.asyncIterator]();
  return promptIterator;
}

function shouldUseColor(): boolean {
  if (process.env.FORCE_COLOR) {
    return true;
  }

  if (process.env.NO_COLOR) {
    return false;
  }

  return output.isTTY;
}

function color(text: string, code: number): string {
  return shouldUseColor() ? `\u001B[${code}m${text}\u001B[0m` : text;
}

function colorPromptAction(message: string): string {
  if (message.startsWith("Overwrite existing ")) {
    return message.replace("Overwrite existing", color("Overwrite existing", 31));
  }

  if (message.startsWith("Create ")) {
    return message.replace("Create", color("Create", 32));
  }

  return message;
}

export async function confirmAction(message: string): Promise<boolean> {
  while (true) {
    const prompt = `${colorPromptAction(message)} [y/n] `;
    const answer = input.isTTY
      ? await prompts().question(prompt)
      : await questionFromPipe(prompt);

    if (answer === undefined) {
      return false;
    }

    const normalized = answer.trim().toLowerCase();

    if (normalized === "y" || normalized === "yes") {
      return true;
    }
    if (normalized === "n" || normalized === "no") {
      return false;
    }

    console.log("Please answer y or n.");
  }
}

async function questionFromPipe(prompt: string): Promise<string | undefined> {
  output.write(prompt);
  const lines = promptLines();
  const answer = await lines.next();
  return answer.done ? undefined : answer.value;
}

export function closePrompts(): void {
  promptInterface?.close();
  promptInterface = undefined;
  promptIterator = undefined;
}
