import { Elysia } from 'elysia';

export const configRoutes = new Elysia()
  .get('/config', () => {
    const predictionIntervalMinutes = parseInt(process.env.PREDICTION_INTERVAL_MINUTES || '60');
    
    return {
      predictionIntervalMinutes,
      predictionIntervalSeconds: predictionIntervalMinutes * 60,
    };
  });
