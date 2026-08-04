import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import Input from './Input.vue'
import Select from './Select.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Input', () => {
  it('emits text values through v-model', async () => {
    const wrapper = mount(Input, {
      props: {
        modelValue: 'Original',
        'onUpdate:modelValue': (value: string | number) => wrapper.setProps({ modelValue: value }),
      },
    })

    await wrapper.get('input').setValue('Updated')

    expect(wrapper.props('modelValue')).toBe('Updated')
  })

  it('coerces populated number inputs while preserving an empty value', async () => {
    const wrapper = mount(Input, {
      props: {
        modelValue: 2,
        type: 'number',
        'onUpdate:modelValue': (value: string | number) => wrapper.setProps({ modelValue: value }),
      },
    })

    await wrapper.get('input').setValue('7')
    expect(wrapper.props('modelValue')).toBe(7)

    await wrapper.get('input').setValue('')
    expect(wrapper.props('modelValue')).toBe('')
  })
})

describe('Select', () => {
  const options = [
    { value: '', label: 'All agents' },
    { value: 'agent-1', label: 'Reception' },
  ]

  it('renders the selected label and forwards trigger attributes', async () => {
    const wrapper = mount(Select, {
      attachTo: document.body,
      attrs: { 'aria-label': 'Agent', class: 'w-52' },
      props: { modelValue: 'agent-1', options },
    })

    await nextTick()

    const trigger = wrapper.get('button')
    expect(trigger.text()).toContain('Reception')
    expect(trigger.attributes('aria-label')).toBe('Agent')
    expect(trigger.classes()).toContain('w-52')
  })

  it('supports the empty-string option used for unscoped filters', async () => {
    const wrapper = mount(Select, {
      attachTo: document.body,
      props: { modelValue: '', options },
    })

    await nextTick()

    expect(wrapper.get('button').text()).toContain('All agents')
  })
})
