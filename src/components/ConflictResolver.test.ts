/**
 * ConflictResolver Component Tests
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ConflictResolver from './ConflictResolver.vue'
import type { ConflictPair } from '@/db/types'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeConflictPair(type: ConflictPair['type'] = 'edit-vs-edit'): ConflictPair {
  const remoteType = type.startsWith('rename') ? 'conversation.rename' :
                     type.startsWith('create') ? 'message.createVariant' :
                     type.includes('delete') && type.startsWith('edit') ? 'message.edit' : 'message.edit'
  const localType = type.endsWith('delete') ? 'message.deleteSubtree' :
                    type === 'rename-vs-rename' ? 'conversation.rename' : 'message.edit'

  // For rename conflicts, use title field
  const isRename = type.startsWith('rename')
  const remotePayload = isRename
    ? { type: 'conversation.rename', conversationId: 'conv-1', title: 'Remote Title' }
    : { type: remoteType, messageId: 'msg-1', content: 'Remote version' }
  const localPayload = isRename
    ? { type: 'conversation.rename', conversationId: 'conv-1', title: 'Local Title' }
    : { type: localType, messageId: 'msg-1', content: 'Local version' }

  return {
    remote: {
      id: 'r1',
      clientId: 'device-B',
      encryptedPayload: btoa(JSON.stringify(remotePayload)),
      conversationId: 'conv-1',
      createdAt: '2026-03-16T00:01:00Z',
    },
    local: {
      id: 'l1',
      createdAt: '2026-03-16T00:00:00Z',
      conversationId: 'conv-1',
      type: localType,
      payload: JSON.stringify(localPayload),
      payloadEnc: null,
      status: 'pending' as const,
      clientId: 'device-A',
      schemaVersion: 1,
    },
    type,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConflictResolver', () => {
  it('renders conflict info for a single edit-vs-edit conflict', () => {
    const pair = makeConflictPair('edit-vs-edit')

    const wrapper = mount(ConflictResolver, {
      props: { conflicts: [pair] },
    })

    // Overlay is rendered
    expect(wrapper.find('[data-testid="conflict-resolver"]').exists()).toBe(true)

    // Progress text shows "Conflict 1 of 1"
    expect(wrapper.text()).toContain('Conflict 1 of 1')

    // Local and remote content are displayed
    expect(wrapper.text()).toContain('Local version')
    expect(wrapper.text()).toContain('Remote version')
  })

  it('emits resolved when all conflicts are resolved and Done is clicked', async () => {
    const pair = makeConflictPair('edit-vs-edit')

    const wrapper = mount(ConflictResolver, {
      props: { conflicts: [pair] },
    })

    // Choose "keep-remote"
    await wrapper.find('[data-testid="keep-remote-btn"]').trigger('click')

    // Click Done
    await wrapper.find('[data-testid="conflict-done-btn"]').trigger('click')

    // Verify emitted event
    const emitted = wrapper.emitted('resolved')
    expect(emitted).toBeTruthy()
    expect(emitted).toHaveLength(1)

    const resolutions = emitted![0]![0] as Array<{ pair: ConflictPair; resolution: string }>
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0]!.resolution).toBe('keep-remote')
    expect(resolutions[0]!.pair).toEqual(pair)
  })

  it('navigates between multiple conflicts', async () => {
    const pair1 = makeConflictPair('edit-vs-edit')
    const pair2 = makeConflictPair('rename-vs-rename')

    const wrapper = mount(ConflictResolver, {
      props: { conflicts: [pair1, pair2] },
    })

    // Initially shows "Conflict 1 of 2"
    expect(wrapper.text()).toContain('Conflict 1 of 2')

    // Click the Next button (second .nav-btn)
    const navButtons = wrapper.findAll('.nav-btn')
    const nextBtn = navButtons[1]!
    await nextBtn.trigger('click')

    // Now shows "Conflict 2 of 2"
    expect(wrapper.text()).toContain('Conflict 2 of 2')
  })

  it('disables Done button until all conflicts are resolved', async () => {
    const pair1 = makeConflictPair('edit-vs-edit')
    const pair2 = makeConflictPair('rename-vs-rename')

    const wrapper = mount(ConflictResolver, {
      props: { conflicts: [pair1, pair2] },
    })

    const doneBtn = wrapper.find('[data-testid="conflict-done-btn"]')

    // Initially disabled (no conflicts resolved)
    expect((doneBtn.element as HTMLButtonElement).disabled).toBe(true)

    // Resolve the first conflict
    await wrapper.find('[data-testid="keep-local-btn"]').trigger('click')

    // Still disabled (only 1 of 2 resolved)
    expect((doneBtn.element as HTMLButtonElement).disabled).toBe(true)

    // Navigate to the second conflict
    const navButtons = wrapper.findAll('.nav-btn')
    await navButtons[1]!.trigger('click')

    // Resolve the second conflict
    await wrapper.find('[data-testid="keep-remote-btn"]').trigger('click')

    // Now enabled (all resolved)
    expect((doneBtn.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('hides Keep Both button for delete conflicts', () => {
    const pair = makeConflictPair('edit-vs-delete')

    const wrapper = mount(ConflictResolver, {
      props: { conflicts: [pair] },
    })

    // Keep Both button should NOT exist for edit-vs-delete
    expect(wrapper.find('[data-testid="keep-both-btn"]').exists()).toBe(false)

    // Keep mine and Keep theirs should still be present
    expect(wrapper.find('[data-testid="keep-local-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="keep-remote-btn"]').exists()).toBe(true)
  })
})
