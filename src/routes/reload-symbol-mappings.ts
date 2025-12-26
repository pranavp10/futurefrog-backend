import { Elysia } from 'elysia';
import { loadSymbolMappings } from '../lib/redis';

/**
 * Admin route to reload symbol mappings from CoinGecko
 * Useful when new coins are added or mappings need to be refreshed
 */
export const reloadSymbolMappingsRoute = new Elysia({ prefix: '/admin' })
    .post('/reload-symbol-mappings', async ({ set }) => {
        try {
            console.log('🔄 Manually reloading symbol mappings...');
            await loadSymbolMappings();
            
            return {
                success: true,
                message: 'Symbol mappings reloaded successfully',
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('Error reloading symbol mappings:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to reload symbol mappings',
            };
        }
    });

