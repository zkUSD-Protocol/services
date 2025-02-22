type LogLevel = 'info' | 'error' | 'warn' | 'debug';

class Logger {
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(message: string, level: LogLevel = 'info'): string {
    return `[${this.getTimestamp()}] ${message}`;
  }

  info(message: string, ...args: any[]): void {
    console.log(this.formatMessage(message), ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(this.formatMessage(message, 'error'), ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage(message, 'warn'), ...args);
  }

  debug(message: string, ...args: any[]): void {
    console.debug(this.formatMessage(message, 'debug'), ...args);
  }

  // Utility method for timing operations
  time(label: string): void {
    console.time(this.formatMessage(label));
  }

  timeEnd(label: string): void {
    console.timeEnd(this.formatMessage(label));
  }
}

export const logger = new Logger();
