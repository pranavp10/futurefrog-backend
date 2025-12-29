import { Elysia } from 'elysia';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { AI_KEYPAIR_NAMES, getAIPublicKey, getAllAIPublicKeys } from '../lib/ai-keypairs-utils';
import { db } from '../db';
import { aiAgentMethodologies } from '../db/schema/ai_agent_methodologies';
import { eq } from 'drizzle-orm';

interface AIKeypairInfo {
    name: string;
    publicKey: string;
    balance: number;
    balanceSOL: string;
    methodology?: {
        displayName: string;
        emoji: string;
        approach: string;
        methodology: string;
        personality: string;
        primaryDataSources: string[];
        analysisWeights: Record<string, number>;
        predictionPrompt: string | null;
    };
}

/**
 * AI Keypairs routes
 * Provides public key information for AI agent wallets
 */
export const aiKeypairsRoutes = new Elysia({ prefix: '/api/ai-keypairs' })
    .get('/', async ({ set }) => {
        try {
            const rpcUrl = process.env.SOLANA_RPC_URL;
            if (!rpcUrl) {
                throw new Error('SOLANA_RPC_URL not configured');
            }

            const connection = new Connection(rpcUrl, 'confirmed');
            const publicKeys = await getAllAIPublicKeys();
            
            // Fetch all methodologies
            const allMethodologies = await db.select().from(aiAgentMethodologies);
            const methodologyMap = new Map(allMethodologies.map(m => [m.agentName, m]));
            
            const keypairs: AIKeypairInfo[] = await Promise.all(
                AI_KEYPAIR_NAMES.map(async (name) => {
                    const publicKey = publicKeys[name];
                    const pubkey = new PublicKey(publicKey);
                    const balance = await connection.getBalance(pubkey);
                    
                    const methodologyData = methodologyMap.get(name);
                    
                    return {
                        name,
                        publicKey,
                        balance,
                        balanceSOL: (balance / LAMPORTS_PER_SOL).toFixed(4),
                        methodology: methodologyData ? {
                            displayName: methodologyData.displayName,
                            emoji: methodologyData.emoji,
                            approach: methodologyData.approach,
                            methodology: methodologyData.methodology,
                            personality: methodologyData.personality,
                            primaryDataSources: JSON.parse(methodologyData.primaryDataSources),
                            analysisWeights: methodologyData.analysisWeights ? JSON.parse(methodologyData.analysisWeights) : {},
                            predictionPrompt: methodologyData.predictionPrompt,
                        } : undefined,
                    };
                })
            );

            return {
                success: true,
                data: {
                    keypairs,
                    count: keypairs.length,
                    timestamp: new Date().toISOString(),
                },
            };
        } catch (error) {
            console.error('Error fetching AI keypairs:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch AI keypairs',
            };
        }
    })
    .get('/:name', async ({ params, set }) => {
        try {
            const { name } = params;
            
            // Validate the name
            if (!AI_KEYPAIR_NAMES.includes(name as any)) {
                set.status = 400;
                return {
                    success: false,
                    error: `Invalid AI keypair name. Valid names: ${AI_KEYPAIR_NAMES.join(', ')}`,
                };
            }

            const rpcUrl = process.env.SOLANA_RPC_URL;
            if (!rpcUrl) {
                throw new Error('SOLANA_RPC_URL not configured');
            }

            const connection = new Connection(rpcUrl, 'confirmed');
            const publicKey = await getAIPublicKey(name as any);
            const pubkey = new PublicKey(publicKey);
            const balance = await connection.getBalance(pubkey);
            
            // Fetch methodology
            const methodologyResult = await db
                .select()
                .from(aiAgentMethodologies)
                .where(eq(aiAgentMethodologies.agentName, name))
                .limit(1);
            
            const methodologyData = methodologyResult[0];

            return {
                success: true,
                data: {
                    name,
                    publicKey,
                    balance,
                    balanceSOL: (balance / LAMPORTS_PER_SOL).toFixed(4),
                    methodology: methodologyData ? {
                        displayName: methodologyData.displayName,
                        emoji: methodologyData.emoji,
                        approach: methodologyData.approach,
                        methodology: methodologyData.methodology,
                        personality: methodologyData.personality,
                        primaryDataSources: JSON.parse(methodologyData.primaryDataSources),
                        analysisWeights: methodologyData.analysisWeights ? JSON.parse(methodologyData.analysisWeights) : {},
                        predictionPrompt: methodologyData.predictionPrompt,
                    } : undefined,
                    timestamp: new Date().toISOString(),
                },
            };
        } catch (error) {
            console.error('Error fetching AI keypair:', error);
            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch AI keypair',
            };
        }
    });
