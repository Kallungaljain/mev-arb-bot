/**
 * WebSocket Event Listener
 * 
 * Connects to Alchemy WebSocket for real-time pool updates.
 * Replaces polling (5s latency) with event-driven architecture (<100ms latency).
 */

import { EventEmitter } from 'events';

export interface SyncEvent {
  poolAddress: string;
  reserve0: bigint;
  reserve1: bigint;
  blockNumber: number;
  transactionHash: string;
  timestamp: number;
}

export interface PendingTxEvent {
  txHash: string;
  from: string;
  to: string;
  data: string;
  value: string;
}

export class WebSocketListener extends EventEmitter {
  private ws: WebSocket | null = null;
  private alchemyWsUrl: string;
  private subscriptions: Map<string, string> = new Map(); // subscriptionId -> poolAddress
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isConnecting = false;
  private isConnected = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private messageQueue: any[] = [];

  constructor(alchemyWsUrl: string) {
    super();
    this.alchemyWsUrl = alchemyWsUrl;
  }

  /**
   * Connect to Alchemy WebSocket
   */
  async connect(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this.isConnecting) {
        reject(new Error('Connection already in progress'));
        return;
      }

      this.isConnecting = true;

      try {
        this.ws = new WebSocket(this.alchemyWsUrl);

        this.ws.onopen = () => {
          console.log('[WS] Connected to Alchemy');
          this.isConnected = true;
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;

          // Start heartbeat
          this.startHeartbeat();

          // Flush message queue
          this.flushMessageQueue();

          this.emit('connected');
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('[WS] Error:', error);
          this.isConnecting = false;
          this.emit('error', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[WS] Disconnected');
          this.isConnected = false;
          this.isConnecting = false;
          this.stopHeartbeat();
          this.emit('disconnected');
          this.attemptReconnect();
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.subscriptions.clear();
  }

  /**
   * Subscribe to Sync events from a Uniswap V2 pair
   * Fires immediately when pool reserves change
   */
  subscribeToPairSync(pairAddress: string): string {
    const subscriptionId = `sync_${pairAddress.toLowerCase()}_${Date.now()}`;

    // Sync event signature: keccak256("Sync(uint112,uint112)")
    const syncEventSignature = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1';

    const subscription = {
      jsonrpc: '2.0',
      method: 'eth_subscribe',
      params: [
        'logs',
        {
          address: pairAddress.toLowerCase(),
          topics: [syncEventSignature],
        },
      ],
      id: subscriptionId,
    };

    this.subscriptions.set(subscriptionId, pairAddress.toLowerCase());
    this.sendMessage(subscription);

    return subscriptionId;
  }

  /**
   * Subscribe to pending transactions (mempool)
   * Detects opportunities before they're in blocks
   */
  subscribeToPendingTransactions(): string {
    const subscriptionId = `pending_${Date.now()}`;

    const subscription = {
      jsonrpc: '2.0',
      method: 'eth_subscribe',
      params: ['newPendingTransactions'],
      id: subscriptionId,
    };

    this.subscriptions.set(subscriptionId, 'pending_txs');
    this.sendMessage(subscription);

    return subscriptionId;
  }

  /**
   * Unsubscribe from a subscription
   */
  unsubscribe(subscriptionId: string) {
    const subscription = {
      jsonrpc: '2.0',
      method: 'eth_unsubscribe',
      params: [subscriptionId],
      id: `unsub_${Date.now()}`,
    };

    this.sendMessage(subscription);
    this.subscriptions.delete(subscriptionId);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data);

      // Handle subscription confirmation
      if (message.result && typeof message.result === 'string') {
        console.log('[WS] Subscription confirmed:', message.result);
        return;
      }

      // Handle subscription updates
      if (message.params?.subscription) {
        const subscriptionId = message.params.subscription;
        const poolAddress = this.subscriptions.get(subscriptionId);

        if (!poolAddress) return;

        // Handle Sync events (pool updates)
        if (poolAddress.startsWith('0x')) {
          this.handleSyncEvent(message.params.result, poolAddress);
        }
        // Handle pending transactions
        else if (poolAddress === 'pending_txs') {
          this.handlePendingTx(message.params.result);
        }
      }

      // Handle errors
      if (message.error) {
        console.error('[WS] Error from server:', message.error);
        this.emit('error', new Error(message.error.message));
      }
    } catch (error) {
      console.error('[WS] Failed to parse message:', error);
    }
  }

  /**
   * Handle Sync event from Uniswap V2 pair
   */
  private handleSyncEvent(logData: any, poolAddress: string) {
    try {
      // Decode log data
      // Sync event: event Sync(uint112 reserve0, uint112 reserve1)
      // Data format: 0x + 64 chars (reserve0) + 64 chars (reserve1)

      const data = logData.data;
      if (!data || data.length < 130) return;

      const reserve0 = BigInt('0x' + data.slice(2, 66));
      const reserve1 = BigInt('0x' + data.slice(66, 130));

      const blockNumber = parseInt(logData.blockNumber, 16);
      const transactionHash = logData.transactionHash;

      const syncEvent: SyncEvent = {
        poolAddress: poolAddress.toLowerCase(),
        reserve0,
        reserve1,
        blockNumber,
        transactionHash,
        timestamp: Date.now(),
      };

      this.emit('sync', syncEvent);
    } catch (error) {
      console.error('[WS] Failed to decode Sync event:', error);
    }
  }

  /**
   * Handle pending transaction
   */
  private handlePendingTx(txHash: string) {
    const event: PendingTxEvent = {
      txHash,
      from: '',
      to: '',
      data: '',
      value: '',
    };

    this.emit('pending', event);
  }

  /**
   * Send message to WebSocket
   */
  private sendMessage(message: any) {
    if (!this.isConnected || !this.ws) {
      this.messageQueue.push(message);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[WS] Failed to send message:', error);
      this.messageQueue.push(message);
    }
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (this.isConnected && this.ws) {
        try {
          this.ws.send(JSON.stringify(message));
        } catch (error) {
          console.error('[WS] Failed to send queued message:', error);
          this.messageQueue.unshift(message);
          break;
        }
      }
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.ws) {
        try {
          this.ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'web3_clientVersion',
            params: [],
            id: `heartbeat_${Date.now()}`,
          }));
        } catch (error) {
          console.error('[WS] Heartbeat failed:', error);
        }
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      this.emit('reconnect_failed');
      return;
    }

    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(error => {
        console.error('[WS] Reconnect failed:', error);
      });
    }, delay);
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      connecting: this.isConnecting,
      subscriptions: this.subscriptions.size,
      reconnectAttempts: this.reconnectAttempts,
      messageQueueLength: this.messageQueue.length,
    };
  }
}
