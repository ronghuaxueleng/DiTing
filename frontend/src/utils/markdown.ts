export function preprocessLaTeX(content: string): string {
    if (!content) return content;
    return content
        .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
        .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
}
