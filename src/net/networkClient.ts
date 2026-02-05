import {
  ClientMessage,
  parseServerMessage,
  serializeMessage,
  ServerMessage
} from "../shared/protocol";

type MessageHandler = (message: ServerMessage) => void;
type CloseHandler = () => void;

export class NetworkClient {
  private socket: WebSocket | null = null;
  private onMessageHandler: MessageHandler | null = null;
  private onCloseHandler: CloseHandler | null = null;
  private connected = false;

  connect(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.addEventListener("open", () => {
        this.connected = true;
        resolve();
      });
      socket.addEventListener("error", () => {
        reject(new Error("Failed to connect to server"));
      });
      socket.addEventListener("close", () => {
        this.connected = false;
        this.onCloseHandler?.();
      });
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          return;
        }
        const message = parseServerMessage(event.data);
        if (!message) {
          return;
        }
        this.onMessageHandler?.(message);
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  onMessage(handler: MessageHandler): void {
    this.onMessageHandler = handler;
  }

  onClose(handler: CloseHandler): void {
    this.onCloseHandler = handler;
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(serializeMessage(message));
  }

  close(): void {
    this.socket?.close();
  }
}
