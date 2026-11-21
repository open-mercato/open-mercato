import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Accordion } from './accordion'

const meta = {
  title: 'Primitives/Accordion',
  component: Accordion,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          '52 px rows, first item open on desktop, all closed on mobile. Triggers are wrapped in headings (`headingLevel`) and carry `aria-expanded`. Plus or chevron glyph is a brand option.',
      },
    },
  },
} satisfies Meta<typeof Accordion>

export default meta
type Story = StoryObj<typeof meta>

const items = (
  <>
    <Accordion.Item value="about">
      <Accordion.Trigger>About this coffee</Accordion.Trigger>
      <Accordion.Content>Washed Guji from the Hambela estate, roasted light for filter. Jasmine, bergamot and ripe peach.</Accordion.Content>
    </Accordion.Item>
    <Accordion.Item value="brew">
      <Accordion.Trigger>Brewing guide</Accordion.Trigger>
      <Accordion.Content>15 g to 250 g of water at 94 °C, 2:45 total brew time on a V60.</Accordion.Content>
    </Accordion.Item>
    <Accordion.Item value="delivery">
      <Accordion.Trigger>Delivery and returns</Accordion.Trigger>
      <Accordion.Content>Roasted on Tuesday, shipped the same day. 30 days to return unopened bags.</Accordion.Content>
    </Accordion.Item>
  </>
)

export const Plus: Story = {
  render: () => (
    <Accordion type="single" collapsible defaultValue="about" className="max-w-xl">
      {items}
    </Accordion>
  ),
}

export const Chevron: Story = {
  render: () => (
    <Accordion type="multiple" icon="chevron" className="max-w-xl">
      {items}
    </Accordion>
  ),
}
