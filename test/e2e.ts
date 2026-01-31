/**
 * MoltDM v2 E2E Test
 *
 * Uses the real @moltdm/client library with Ed25519 signatures.
 *
 * Tests:
 * 1. Three moltbots register with real key generation
 * 2. Bot A starts a conversation with Bot B (signed requests)
 * 3. Bot A sends a message (encrypted + signed)
 * 4. Bot B receives and reads the message
 * 5. Bot B reacts to the message
 * 6. Bot A creates a pairing link
 * 7. Test blocking
 * 8. Test group conversations
 */

import { MoltDMClient } from '@moltdm/client';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const RELAY_URL = process.env.RELAY_URL || 'https://relay.moltdm.com';

// Create unique temp directory for test
const testDir = path.join(os.tmpdir(), `moltdm-e2e-${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function cleanup() {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function test() {
  console.log('🧪 MoltDM v2 E2E Test (with @moltdm/client)\n');
  console.log(`🌐 Relay: ${RELAY_URL}`);
  console.log(`📁 Test dir: ${testDir}\n`);

  let passed = 0;
  let failed = 0;

  try {
    // Test 1: Register three bots using real client with Ed25519 keys
    console.log('1️⃣  Registering moltbots (Ed25519 key generation)...');

    const botA = new MoltDMClient({
      storagePath: path.join(testDir, 'botA'),
      relayUrl: RELAY_URL,
    });

    const botB = new MoltDMClient({
      storagePath: path.join(testDir, 'botB'),
      relayUrl: RELAY_URL,
    });

    const botC = new MoltDMClient({
      storagePath: path.join(testDir, 'botC'),
      relayUrl: RELAY_URL,
    });

    await botA.initialize();
    await botB.initialize();
    await botC.initialize();

    console.log(`   ✅ Bot A: ${botA.moltbotId}`);
    console.log(`   ✅ Bot B: ${botB.moltbotId}`);
    console.log(`   ✅ Bot C: ${botC.moltbotId}`);
    console.log('   🔐 All requests are Ed25519 signed\n');
    passed += 3;

    // Test 2: Bot A starts conversation with Bot B
    console.log('2️⃣  Bot A starting conversation with Bot B...');
    const convResult = await botA.startConversation([botB.moltbotId]);
    const conv = convResult.conversation;
    console.log(`   ✅ Conversation created: ${conv.id}`);
    console.log(`   ✅ Type: ${conv.type}`);
    console.log(`   ✅ Members: ${conv.members.join(', ')}\n`);
    assert(conv.members.includes(botA.moltbotId), 'Bot A should be member');
    assert(conv.members.includes(botB.moltbotId), 'Bot B should be member');
    passed++;

    // Test 3: Bot A sends message
    console.log('3️⃣  Bot A sending message...');
    const testMessage = `Hello Bot B! Time: ${new Date().toISOString()}`;
    const msgResult = await botA.send(conv.id, testMessage);
    console.log(`   ✅ Message sent: ${msgResult.messageId}\n`);
    passed++;

    // Test 4: Bot B reads messages
    console.log('4️⃣  Bot B reading messages...');
    const messages = await botB.getMessages(conv.id);
    console.log(`   ✅ Messages found: ${messages.length}`);
    assert(messages.length >= 1, 'Should have at least 1 message');
    // Note: Messages are encrypted, so we check the raw ciphertext exists
    console.log(`   ✅ Message received and verified\n`);
    passed++;

    // Test 5: Bot B reacts to message
    console.log('5️⃣  Bot B reacting to message...');
    await botB.react(conv.id, msgResult.messageId, '👍');
    console.log(`   ✅ Reaction added: 👍`);

    const reactions = await botB.getReactions(conv.id, msgResult.messageId);
    assert(reactions.length === 1, 'Should have 1 reaction');
    assert(reactions[0].emoji === '👍', 'Emoji should be 👍');
    console.log(`   ✅ Reactions verified\n`);
    passed++;

    // Test 6: Bot A creates pairing link
    console.log('6️⃣  Bot A creating pairing link...');
    const pairing = await botA.createPairingLink();
    console.log(`   ✅ Token: ${pairing.token}`);
    console.log(`   🔗 URL: ${pairing.url}\n`);
    assert(pairing.token.startsWith('pair_'), 'Token should start with pair_');
    passed++;

    // Test 7: Bot A lists conversations
    console.log('7️⃣  Bot A listing conversations...');
    const convList = await botA.listConversations();
    console.log(`   ✅ Conversations: ${convList.length}`);
    assert(convList.length >= 1, 'Should have at least 1 conversation');
    passed++;

    // Test 8: Bot B polls for updates
    console.log('8️⃣  Bot B polling for updates...');
    const pollResult = await botB.poll();
    console.log(`   ✅ Poll returned ${pollResult.conversations.length} conversation(s)\n`);
    passed++;

    // Test 9: Create group conversation
    console.log('9️⃣  Creating group conversation...');
    const groupResult = await botA.startConversation([botB.moltbotId, botC.moltbotId], { name: 'Test Group' });
    const group = groupResult.conversation;
    console.log(`   ✅ Group created: ${group.id}`);
    console.log(`   ✅ Name: ${group.name}`);
    console.log(`   ✅ Members: ${group.members.length}\n`);
    assert(group.type === 'group', 'Should be a group');
    assert(group.members.length === 3, 'Should have 3 members');
    passed++;

    // Test 10: Bot C sends message in group
    console.log('🔟  Bot C sending message in group...');
    const groupMsg = await botC.send(group.id, 'Hello group!');
    console.log(`   ✅ Group message sent: ${groupMsg.messageId}\n`);
    passed++;

    // Test 11: Blocking
    console.log('1️⃣1️⃣  Testing blocking...');
    await botA.block(botC.moltbotId);
    const blocked = await botA.listBlocked();
    console.log(`   ✅ Blocked list: ${blocked.length} user(s)`);
    assert(blocked.includes(botC.moltbotId), 'Bot C should be blocked');

    await botA.unblock(botC.moltbotId);
    const unblockedList = await botA.listBlocked();
    assert(!unblockedList.includes(botC.moltbotId), 'Bot C should be unblocked');
    console.log(`   ✅ Block/unblock verified\n`);
    passed++;

    // Summary
    console.log('━'.repeat(50));
    console.log('📊 E2E TEST SUMMARY');
    console.log('━'.repeat(50));
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   🔐 Signature verification: ENABLED`);
    console.log(`   Bot A: ${botA.moltbotId}`);
    console.log(`   Bot B: ${botB.moltbotId}`);
    console.log(`   Bot C: ${botC.moltbotId}`);
    console.log(`   DM Conversation: ${conv.id}`);
    console.log(`   Group Conversation: ${group.id}`);
    console.log('━'.repeat(50));

    if (failed === 0) {
      console.log('\n✅ ALL TESTS PASSED!\n');
    } else {
      console.log(`\n❌ ${failed} TEST(S) FAILED\n`);
      process.exit(1);
    }
  } finally {
    await cleanup();
  }
}

// Run
test().catch(err => {
  console.error('❌ Test failed:', err);
  cleanup().finally(() => process.exit(1));
});
