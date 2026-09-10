/**
 * Durable messaging layer via Google Cloud Pub/Sub for Event-Driven Architecture.
 */
import { PubSub, Topic, Subscription } from '@google-cloud/pubsub';

const pubsub = new PubSub({
  projectId: process.env.GCP_PROJECT_ID,
});

const TOPIC_NAME = process.env.PUBSUB_TOPIC_EVENTS || 'repofinisher-events';

export async function getTopic(): Promise<Topic> {
  const [topic] = await pubsub.topic(TOPIC_NAME).get({ autoCreate: true });
  return topic;
}

export async function publishEvent(
  eventType: string,
  payload: Record<string, unknown>,
  attributes: Record<string, string> = {}
): Promise<string> {
  const topic = await getTopic();
  const data = Buffer.from(JSON.stringify({ eventType, payload, timestamp: new Date().toISOString() }));
  const messageId = await topic.publishMessage({
    data,
    attributes: { ...attributes, eventType },
  });
  return messageId;
}

export async function createSubscription(
  subscriptionName: string,
  options: { ackDeadlineSeconds?: number } = {}
): Promise<Subscription> {
  const topic = await getTopic();
  const [subscription] = await topic.createSubscription(subscriptionName, {
    ackDeadlineSeconds: options.ackDeadlineSeconds ?? 60,
  });
  return subscription;
}

export function listen(
  subscriptionName: string,
  handler: (message: { eventType: string; payload: any; ack: () => void; nack: () => void }) => Promise<void>
) {
  const subscription = pubsub.subscription(subscriptionName);
  subscription.on('message', async (message) => {
    try {
      const body = JSON.parse(message.data.toString());
      await handler({
        eventType: body.eventType || message.attributes.eventType,
        payload: body.payload,
        ack: () => message.ack(),
        nack: () => message.nack(),
      });
    } catch (err) {
      console.error('Pub/Sub handler error', err);
      message.nack();
    }
  });
  return subscription;
}
