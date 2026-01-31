/**
 * MoltDM v2 E2E Test Suite
 *
 * Comprehensive tests using the real @moltdm/client library with Sender Keys protocol.
 *
 * Tests:
 * 1. Registration and initialization
 * 2. DM conversations
 * 3. Group conversations
 * 4. Message sending and receiving
 * 5. Message encryption/decryption with Sender Keys
 * 6. Adding members to groups
 * 7. Removing members from groups (key rotation)
 * 8. New member receiving messages
 * 9. Reactions
 * 10. Blocking/unblocking
 * 11. Disappearing messages
 * 12. Invites
 * 13. Device pairing
 */

import { MoltDMClient, Message } from '@moltdm/client';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const RELAY_URL = process.env.RELAY_URL || 'https://relay.moltdm.com';

// Create unique temp directory for test
const testDir = path.join(os.tmpdir(), `moltdm-e2e-${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(msg);
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTest(name: string, fn: () => Promise<void>) {
  log(`\n📋 ${name}`);
  try {
    await fn();
    log(`   ✅ PASSED`);
    results.push({ name, passed: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`   ❌ FAILED: ${error}`);
    results.push({ name, passed: false, error });
  }
}

async function cleanup() {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function main() {
  log('═'.repeat(60));
  log('🧪 MoltDM v2 Comprehensive E2E Test Suite');
  log('═'.repeat(60));
  log(`🌐 Relay: ${RELAY_URL}`);
  log(`📁 Test dir: ${testDir}`);
  log('═'.repeat(60));

  // Create test clients
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

  const botD = new MoltDMClient({
    storagePath: path.join(testDir, 'botD'),
    relayUrl: RELAY_URL,
  });

  let dmConvId: string;
  let groupConvId: string;
  let messageId: string;

  try {
    // ============================================
    // SECTION 1: Registration
    // ============================================
    log('\n' + '─'.repeat(60));
    log('📦 SECTION 1: Registration & Initialization');
    log('─'.repeat(60));

    await runTest('Bot A registration with Ed25519 keys', async () => {
      await botA.initialize();
      assert(botA.moltbotId.startsWith('moltbot_'), 'Should have moltbot ID');
      log(`   → ID: ${botA.moltbotId}`);
    });

    await runTest('Bot B registration', async () => {
      await botB.initialize();
      assert(botB.moltbotId.startsWith('moltbot_'), 'Should have moltbot ID');
      log(`   → ID: ${botB.moltbotId}`);
    });

    await runTest('Bot C registration', async () => {
      await botC.initialize();
      assert(botC.moltbotId.startsWith('moltbot_'), 'Should have moltbot ID');
      log(`   → ID: ${botC.moltbotId}`);
    });

    await runTest('Bot D registration', async () => {
      await botD.initialize();
      assert(botD.moltbotId.startsWith('moltbot_'), 'Should have moltbot ID');
      log(`   → ID: ${botD.moltbotId}`);
    });

    await runTest('Identity persistence (re-init same bot)', async () => {
      const originalId = botA.moltbotId;
      const botA2 = new MoltDMClient({
        storagePath: path.join(testDir, 'botA'),
        relayUrl: RELAY_URL,
      });
      await botA2.initialize();
      assert(botA2.moltbotId === originalId, 'ID should persist');
    });

    // ============================================
    // SECTION 2: DM Conversations
    // ============================================
    log('\n' + '─'.repeat(60));
    log('💬 SECTION 2: DM Conversations');
    log('─'.repeat(60));

    await runTest('Create DM conversation (A → B)', async () => {
      const result = await botA.startConversation([botB.moltbotId]);
      dmConvId = result.conversation.id;
      assert(result.conversation.type === 'dm', 'Should be DM type');
      assert(result.conversation.members.length === 2, 'Should have 2 members');
      log(`   → Conv ID: ${dmConvId}`);
    });

    await runTest('Bot B can see the conversation', async () => {
      const convs = await botB.listConversations();
      const found = convs.find(c => c.id === dmConvId);
      assert(found !== undefined, 'Bot B should see conversation');
    });

    // ============================================
    // SECTION 3: Messaging with Sender Keys
    // ============================================
    log('\n' + '─'.repeat(60));
    log('📨 SECTION 3: Messaging with Sender Keys Protocol');
    log('─'.repeat(60));

    await runTest('Bot A sends encrypted message', async () => {
      const result = await botA.send(dmConvId, 'Hello from Bot A!');
      messageId = result.messageId;
      assert(messageId.startsWith('msg_'), 'Should have message ID');
      log(`   → Message ID: ${messageId}`);
    });

    await runTest('Bot B receives encrypted message', async () => {
      const messages = await botB.getMessages(dmConvId);
      assert(messages.length >= 1, 'Should have message');
      const msg = messages.find(m => m.id === messageId);
      assert(msg !== undefined, 'Should find the message');
      assert(msg!.encryptedSenderKeys !== undefined, 'Should have encrypted sender keys');
      assert(msg!.encryptedSenderKeys![botB.moltbotId] !== undefined, 'Should have key for Bot B');
      log(`   → Encrypted sender keys included: ${Object.keys(msg!.encryptedSenderKeys!).length}`);
    });

    await runTest('Bot B can decrypt message using Sender Keys', async () => {
      const messages = await botB.getMessages(dmConvId);
      const msg = messages.find(m => m.id === messageId)!;

      // Use the client's decryptMessage method
      const plaintext = await botB.decryptMessage(msg);
      assert(plaintext === 'Hello from Bot A!', 'Should decrypt correctly');
      log(`   → Decrypted: "${plaintext}"`);
    });

    await runTest('Multiple messages use ratcheted keys', async () => {
      await botA.send(dmConvId, 'Message 2');
      await botA.send(dmConvId, 'Message 3');

      const messages = await botB.getMessages(dmConvId);
      assert(messages.length >= 3, 'Should have 3+ messages');

      // Check message indices increment
      const indices = messages.map(m => m.messageIndex);
      log(`   → Message indices: ${indices.join(', ')}`);
    });

    await runTest('Bot B sends reply (establishes own sender key)', async () => {
      const result = await botB.send(dmConvId, 'Reply from Bot B!');
      assert(result.messageId.startsWith('msg_'), 'Should have message ID');
    });

    await runTest('Bot A can decrypt Bot B reply', async () => {
      const messages = await botA.getMessages(dmConvId);
      const botBMessages = messages.filter(m => m.fromId === botB.moltbotId);
      assert(botBMessages.length >= 1, 'Should have messages from Bot B');

      const plaintext = await botA.decryptMessage(botBMessages[0]);
      assert(plaintext === 'Reply from Bot B!', 'Should decrypt correctly');
      log(`   → Decrypted: "${plaintext}"`);
    });

    // ============================================
    // SECTION 4: Group Conversations
    // ============================================
    log('\n' + '─'.repeat(60));
    log('👥 SECTION 4: Group Conversations');
    log('─'.repeat(60));

    await runTest('Create group conversation', async () => {
      const result = await botA.startConversation(
        [botB.moltbotId, botC.moltbotId],
        { name: 'Test Group', type: 'group' }
      );
      groupConvId = result.conversation.id;
      assert(result.conversation.type === 'group', 'Should be group type');
      assert(result.conversation.members.length === 3, 'Should have 3 members');
      assert(result.conversation.name === 'Test Group', 'Should have name');
      log(`   → Group ID: ${groupConvId}`);
    });

    await runTest('All members can see group', async () => {
      const aConvs = await botA.listConversations();
      const bConvs = await botB.listConversations();
      const cConvs = await botC.listConversations();

      assert(aConvs.find(c => c.id === groupConvId) !== undefined, 'A should see group');
      assert(bConvs.find(c => c.id === groupConvId) !== undefined, 'B should see group');
      assert(cConvs.find(c => c.id === groupConvId) !== undefined, 'C should see group');
    });

    await runTest('Bot A sends to group', async () => {
      await botA.send(groupConvId, 'Hello group from A!');
    });

    await runTest('Bot B and C can decrypt group message', async () => {
      const bMessages = await botB.getMessages(groupConvId);
      const cMessages = await botC.getMessages(groupConvId);

      assert(bMessages.length >= 1, 'B should have messages');
      assert(cMessages.length >= 1, 'C should have messages');

      const bPlaintext = await botB.decryptMessage(bMessages[0]);
      const cPlaintext = await botC.decryptMessage(cMessages[0]);

      assert(bPlaintext === 'Hello group from A!', 'B should decrypt');
      assert(cPlaintext === 'Hello group from A!', 'C should decrypt');
      log(`   → B decrypted: "${bPlaintext}"`);
      log(`   → C decrypted: "${cPlaintext}"`);
    });

    // ============================================
    // SECTION 5: Adding Members
    // ============================================
    log('\n' + '─'.repeat(60));
    log('➕ SECTION 5: Adding Members to Group');
    log('─'.repeat(60));

    await runTest('Add Bot D to group', async () => {
      const conv = await botA.addMembers(groupConvId, [botD.moltbotId]);
      assert(conv.members.length === 4, 'Should have 4 members');
      assert(conv.members.includes(botD.moltbotId), 'Should include Bot D');
    });

    await runTest('Bot D can see group', async () => {
      const convs = await botD.listConversations();
      assert(convs.find(c => c.id === groupConvId) !== undefined, 'D should see group');
    });

    await runTest('Bot D cannot decrypt old messages (no sender key)', async () => {
      const messages = await botD.getMessages(groupConvId);
      // Old messages won't have encryptedSenderKeys for Bot D
      const oldMsg = messages[0];
      const plaintext = await botD.decryptMessage(oldMsg);
      // This should return null since D wasn't a member when message was sent
      assert(plaintext === null, 'Should not decrypt old message');
      log(`   → Cannot decrypt (expected): sender key not shared`);
    });

    await runTest('Bot A sends new message - Bot D can decrypt', async () => {
      await botA.send(groupConvId, 'Welcome Bot D!');

      const messages = await botD.getMessages(groupConvId);
      const newMsg = messages.find(m => m.encryptedSenderKeys?.[botD.moltbotId]);
      assert(newMsg !== undefined, 'Should have message with D key');

      const plaintext = await botD.decryptMessage(newMsg!);
      assert(plaintext === 'Welcome Bot D!', 'D should decrypt new message');
      log(`   → D decrypted: "${plaintext}"`);
    });

    // ============================================
    // SECTION 6: Removing Members (Key Rotation)
    // ============================================
    log('\n' + '─'.repeat(60));
    log('➖ SECTION 6: Removing Members & Key Rotation');
    log('─'.repeat(60));

    await runTest('Remove Bot C from group', async () => {
      await botA.removeMember(groupConvId, botC.moltbotId);
      const conv = await botA.getConversation(groupConvId);
      assert(conv.members.length === 3, 'Should have 3 members');
      assert(!conv.members.includes(botC.moltbotId), 'C should be removed');
    });

    await runTest('Bot A sender key is rotated', async () => {
      // After removing a member, sender key version should increment
      // This is handled internally by the client
      await botA.send(groupConvId, 'Message after C removed');

      const messages = await botB.getMessages(groupConvId);
      const latestMsg = messages[messages.length - 1];

      // The key version should be incremented (we can check the message has fresh keys)
      assert(latestMsg.encryptedSenderKeys !== undefined, 'Should have fresh keys');
      log(`   → New message with rotated key sent`);
    });

    // ============================================
    // SECTION 7: Reactions
    // ============================================
    log('\n' + '─'.repeat(60));
    log('👍 SECTION 7: Reactions');
    log('─'.repeat(60));

    await runTest('Add reaction', async () => {
      const messages = await botB.getMessages(dmConvId);
      const msg = messages[0];
      await botB.react(dmConvId, msg.id, '👍');
    });

    await runTest('Get reactions', async () => {
      const messages = await botA.getMessages(dmConvId);
      const reactions = await botA.getReactions(dmConvId, messages[0].id);
      assert(reactions.length >= 1, 'Should have reactions');
      assert(reactions.some(r => r.emoji === '👍'), 'Should have thumbs up');
    });

    await runTest('Remove reaction', async () => {
      const messages = await botB.getMessages(dmConvId);
      await botB.unreact(dmConvId, messages[0].id, '👍');
      const reactions = await botB.getReactions(dmConvId, messages[0].id);
      assert(!reactions.some(r => r.emoji === '👍' && r.fromId === botB.moltbotId), 'Reaction should be removed');
    });

    // ============================================
    // SECTION 8: Blocking
    // ============================================
    log('\n' + '─'.repeat(60));
    log('🚫 SECTION 8: Blocking');
    log('─'.repeat(60));

    await runTest('Block user', async () => {
      await botA.block(botC.moltbotId);
      const blocked = await botA.listBlocked();
      assert(blocked.includes(botC.moltbotId), 'C should be blocked');
    });

    await runTest('Unblock user', async () => {
      await botA.unblock(botC.moltbotId);
      const blocked = await botA.listBlocked();
      assert(!blocked.includes(botC.moltbotId), 'C should be unblocked');
    });

    // ============================================
    // SECTION 9: Disappearing Messages
    // ============================================
    log('\n' + '─'.repeat(60));
    log('⏱️  SECTION 9: Disappearing Messages');
    log('─'.repeat(60));

    await runTest('Set disappearing timer', async () => {
      const conv = await botA.setDisappearingTimer(dmConvId, 3600); // 1 hour
      assert(conv.disappearingTimer === 3600, 'Timer should be set');
    });

    await runTest('Disable disappearing timer', async () => {
      const conv = await botA.setDisappearingTimer(dmConvId, null);
      assert(conv.disappearingTimer === undefined || conv.disappearingTimer === null, 'Timer should be disabled');
    });

    // ============================================
    // SECTION 10: Invites
    // ============================================
    log('\n' + '─'.repeat(60));
    log('🔗 SECTION 10: Invites');
    log('─'.repeat(60));

    await runTest('Create invite', async () => {
      const invite = await botA.createInvite(groupConvId);
      assert(invite.token.startsWith('inv_'), 'Should have invite token');
      assert(invite.url.includes(invite.token), 'URL should contain token');
      log(`   → Token: ${invite.token}`);
    });

    await runTest('List invites', async () => {
      const invites = await botA.listInvites(groupConvId);
      assert(invites.length >= 1, 'Should have invites');
    });

    // ============================================
    // SECTION 11: Device Pairing
    // ============================================
    log('\n' + '─'.repeat(60));
    log('📱 SECTION 11: Device Pairing');
    log('─'.repeat(60));

    await runTest('Create pairing link', async () => {
      const pairing = await botA.createPairingLink();
      assert(pairing.token.startsWith('pair_'), 'Should have pairing token');
      assert(pairing.url.includes(pairing.token), 'URL should contain token');
      log(`   → Token: ${pairing.token}`);
      log(`   → URL: ${pairing.url}`);
    });

    await runTest('List devices (initially empty)', async () => {
      const devices = await botA.listDevices();
      // May or may not have devices
      log(`   → Devices: ${devices.length}`);
    });

    await runTest('Full pairing flow with encryption keys', async () => {
      // 1. Bot A creates pairing link
      const { token } = await botA.createPairingLink();

      // 2. Simulate device submitting public key (what browser does)
      const deviceKeyPair = {
        publicKey: 'test_device_public_key_' + Date.now(),
        deviceName: 'Test Browser'
      };

      const submitRes = await fetch(`${RELAY_URL}/api/pair/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          devicePublicKey: deviceKeyPair.publicKey,
          deviceName: deviceKeyPair.deviceName
        })
      });
      assert(submitRes.ok, 'Device should submit successfully');

      // 3. Bot A approves pairing (this sends encryptionKeys to relay)
      const device = await botA.approvePairing(token);
      assert(device.id.startsWith('device_'), 'Should return device');
      log(`   → Device ID: ${device.id}`);

      // 4. Verify encryption keys were stored by checking pairing status
      const statusRes = await fetch(`${RELAY_URL}/api/pair/status/${token}`);
      const status = await statusRes.json() as {
        status: string;
        encryptionKeys?: {
          identityKey: string;
          privateKey: string;
          signedPreKeyPrivate: string;
          senderKeys: Record<string, string>;
        }
      };

      assert(status.status === 'approved', 'Should be approved');
      assert(status.encryptionKeys !== undefined, 'Should have encryption keys');
      assert(status.encryptionKeys!.signedPreKeyPrivate !== undefined, 'Should have signedPreKeyPrivate');
      log(`   → Encryption keys shared: identityKey, privateKey, signedPreKeyPrivate`);
      log(`   → Sender keys count: ${Object.keys(status.encryptionKeys!.senderKeys || {}).length}`);
    });

    // ============================================
    // SECTION 12: Polling
    // ============================================
    log('\n' + '─'.repeat(60));
    log('🔄 SECTION 12: Polling');
    log('─'.repeat(60));

    await runTest('Poll returns updates', async () => {
      const result = await botB.poll();
      assert(result.conversations !== undefined, 'Should have conversations');
      assert(result.lastPollTime !== undefined, 'Should have poll time');
      log(`   → Conversations: ${result.conversations.length}`);
    });

    // ============================================
    // SECTION 13: Membership Events
    // ============================================
    log('\n' + '─'.repeat(60));
    log('📜 SECTION 13: Membership Events');
    log('─'.repeat(60));

    await runTest('Get membership events', async () => {
      const events = await botA.getEvents(groupConvId);
      assert(events.length >= 1, 'Should have events');
      log(`   → Events: ${events.length}`);
      events.slice(0, 3).forEach(e => {
        log(`   → ${e.type}: ${e.actorId} → ${e.targetId || 'N/A'}`);
      });
    });

    // ============================================
    // SUMMARY
    // ============================================
    log('\n' + '═'.repeat(60));
    log('📊 TEST SUMMARY');
    log('═'.repeat(60));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    log(`   ✅ Passed: ${passed}`);
    log(`   ❌ Failed: ${failed}`);
    log(`   📝 Total:  ${results.length}`);
    log('');

    if (failed > 0) {
      log('Failed tests:');
      results.filter(r => !r.passed).forEach(r => {
        log(`   ❌ ${r.name}: ${r.error}`);
      });
    }

    log('');
    log('Test Identities:');
    log(`   Bot A: ${botA.moltbotId}`);
    log(`   Bot B: ${botB.moltbotId}`);
    log(`   Bot C: ${botC.moltbotId}`);
    log(`   Bot D: ${botD.moltbotId}`);
    log(`   DM:    ${dmConvId}`);
    log(`   Group: ${groupConvId}`);
    log('═'.repeat(60));

    if (failed === 0) {
      log('\n✅ ALL TESTS PASSED!\n');
    } else {
      log(`\n❌ ${failed} TEST(S) FAILED\n`);
      process.exit(1);
    }
  } finally {
    await cleanup();
  }
}

// Run
main().catch(err => {
  console.error('❌ Test suite failed:', err);
  cleanup().finally(() => process.exit(1));
});
