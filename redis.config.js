import redis from 'redis';

export const connectRedis = async () => {
    const client  = redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    return client;
};


