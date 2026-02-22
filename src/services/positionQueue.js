class PositionQueue {
  constructor({ stateStore, publisher, channel, serverId, intervalMs = 80 }) {
    this.stateStore = stateStore;
    this.publisher = publisher;
    this.channel = channel;
    this.serverId = serverId;
    this.intervalMs = intervalMs;
    this.buffer = [];
    this.timer = null;
  }

  start() {
    if (!this.timer) {
      this.timer = setInterval(() => {
        this.flush().catch((error) => {
          console.error('Failed to flush position queue', error);
        });
      }, this.intervalMs);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  enqueue(update) {
    this.buffer.push(update);
  }

  async flush() {
    if (this.buffer.length === 0) {
      return;
    }
    const batch = this.buffer.splice(0, this.buffer.length);
    await this.stateStore.savePlayerPositions(batch);
    await this.publisher.publish(
      this.channel,
      JSON.stringify({
        serverId: this.serverId,
        message: { type: 'position-batch', updates: batch },
      })
    );
  }
}

function createPositionQueue(options) {
  const queue = new PositionQueue(options);
  queue.start();
  return queue;
}

module.exports = { createPositionQueue };
