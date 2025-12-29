/**
 * Test script to verify user predictions fetching from blockchain
 * Run with: bun run scripts/test-user-predictions-fetch.ts
 */

import { Connection } from '@solana/web3.js';
import { fetchAllUserPredictions } from '../src/lib/solana-predictions';

async function main() {
    console.log('🧪 Testing User Predictions Fetch\n');

    // Get RPC URL from environment or use default
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    console.log(`🔗 Connecting to Solana RPC: ${rpcUrl}\n`);

    const connection = new Connection(rpcUrl, 'confirmed');

    try {
        console.log('📡 Fetching all user predictions from blockchain...');
        const startTime = Date.now();

        const allPredictions = await fetchAllUserPredictions(connection);

        const duration = Date.now() - startTime;

        console.log('\n✅ Fetch completed!');
        console.log(`   Duration: ${duration}ms`);
        console.log(`   Users found: ${allPredictions.length}\n`);

        if (allPredictions.length > 0) {
            console.log('📊 Sample Data:\n');

            // Show first 3 users
            allPredictions.slice(0, 3).forEach((user, idx) => {
                console.log(`${idx + 1}. User: ${user.userAddress.slice(0, 8)}...${user.userAddress.slice(-8)}`);
                console.log(`   Points: ${user.predictions.points}`);
                console.log(`   Top Performers: [${user.predictions.topPerformer.join(', ')}]`);
                console.log(`   Top Performer Timestamps: [${user.predictions.topPerformerTimestamps.map(t => t > 0 ? new Date(t * 1000).toISOString().split('T')[0] : '-').join(', ')}]`);
                console.log(`   Worst Performers: [${user.predictions.worstPerformer.join(', ')}]`);
                console.log(`   Last Updated: ${user.predictions.lastUpdated > 0 ? new Date(user.predictions.lastUpdated * 1000).toISOString() : 'Never'}`);
                console.log('');
            });

            // Summary statistics
            const totalPoints = allPredictions.reduce((sum, u) => sum + u.predictions.points, 0);
            const usersWithPredictions = allPredictions.filter(u => 
                u.predictions.topPerformer.some(p => p.trim() !== '') ||
                u.predictions.worstPerformer.some(p => p.trim() !== '')
            ).length;

            // Find most common predictions
            const allTopPredictions = allPredictions.flatMap(u => u.predictions.topPerformer.filter(p => p.trim() !== ''));
            const predictionCounts = allTopPredictions.reduce((acc, pred) => {
                acc[pred] = (acc[pred] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
            
            const topPredictions = Object.entries(predictionCounts)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 5);

            console.log('📈 Statistics:');
            console.log(`   Total Points: ${totalPoints.toLocaleString()}`);
            console.log(`   Users with Active Predictions: ${usersWithPredictions}`);
            console.log(`   Average Points: ${Math.round(totalPoints / allPredictions.length)}`);
            
            if (topPredictions.length > 0) {
                console.log(`\n   Most Popular Predictions:`);
                topPredictions.forEach(([crypto, count]) => {
                    console.log(`     - ${crypto}: ${count} user(s)`);
                });
            }
        } else {
            console.log('ℹ️  No users found with initialized accounts');
        }

        console.log('\n✅ Test completed successfully!');
    } catch (error) {
        console.error('\n❌ Error during test:', error);
        process.exit(1);
    }
}

main();






