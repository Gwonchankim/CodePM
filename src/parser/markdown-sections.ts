export interface MarkdownSections {
  sections: Map<string, string[]>;
}

export function parseMarkdownSections(markdown: string): MarkdownSections {
  const sections = new Map<string, string[]>();
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let currentHeading: string | null = null;
  let currentLines: string[] = [];
  let inFence = false;

  function flushCurrentSection(): void {
    if (!currentHeading) {
      return;
    }

    const previous = sections.get(currentHeading) ?? [];
    sections.set(currentHeading, [...previous, currentLines.join("\n").trim()]);
  }

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      if (currentHeading) {
        currentLines.push(line);
      }
      continue;
    }

    const headingMatch = !inFence ? line.match(/^##\s+(.+?)\s*$/) : null;
    if (headingMatch?.[1]) {
      flushCurrentSection();
      currentHeading = headingMatch[1];
      currentLines = [];
      continue;
    }

    if (currentHeading) {
      currentLines.push(line);
    }
  }

  flushCurrentSection();

  return { sections };
}

export function getSingleSection(
  sections: Map<string, string[]>,
  heading: string
): string | undefined {
  const values = sections.get(heading);
  return values?.length === 1 ? values[0] : undefined;
}
