/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface MealLogReminderProps {
  client_first_name?: string
  /** Human labels of the meals still unlogged today, e.g. ["Meal 2", "Dinner"]. */
  missed_meals?: string[]
  portal_url?: string
}

const list = (items: string[]) =>
  items.length <= 1
    ? items[0] ?? 'a meal'
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

const MealLogReminderEmail = ({
  client_first_name = 'there',
  missed_meals = ['your meals'],
  portal_url = '',
}: MealLogReminderProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>A quick nudge to log today's meals</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Did you log today's meals?</Heading>
        <Text style={text}>Hi {client_first_name},</Text>
        <Text style={text}>
          It looks like {list(missed_meals)} {missed_meals.length > 1 ? 'are' : 'is'} still
          unlogged for today. If you ate, it only takes a few seconds to mark it off in your
          portal.
        </Text>
        <ul style={ulStyle}>
          {missed_meals.map((m) => (
            <li key={m} style={liStyle}>
              {m}
            </li>
          ))}
        </ul>
        <Text style={{ ...text, margin: '0 0 20px' }}>
          <Button href={portal_url} style={button}>
            Log my meals
          </Button>
        </Text>
        <Text style={text}>
          Or open your portal directly:{' '}
          <Link href={portal_url} style={link}>
            {portal_url}
          </Link>
        </Text>
        <Text style={signoff}>Talk soon,</Text>
        <Text style={signoff}>Tenacia</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: MealLogReminderEmail,
  subject: (data: Record<string, unknown>) => {
    const meals = Array.isArray(data?.missed_meals) ? (data.missed_meals as string[]) : []
    return meals.length === 1
      ? `Don't forget to log ${meals[0]}`
      : "Don't forget to log today's meals"
  },
  displayName: 'Meal log reminder',
  previewData: {
    client_first_name: 'Jane',
    missed_meals: ['Meal 3', 'Meal 4'],
    portal_url: 'https://tenacia.app/portal/sample-token',
  },
} satisfies TemplateEntry

export default MealLogReminderEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '24px 25px', maxWidth: '560px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#111111',
  margin: '0 0 20px',
}
const text = { fontSize: '15px', color: '#3f4145', lineHeight: '1.6', margin: '0 0 18px' }
const ulStyle = { margin: '0 0 18px', paddingLeft: '20px' }
const liStyle = { fontSize: '15px', color: '#3f4145', lineHeight: '1.8' }
const button = {
  backgroundColor: '#1a6b54',
  color: '#ffffff',
  borderRadius: '6px',
  fontSize: '15px',
  fontWeight: 'bold' as const,
  padding: '12px 22px',
  textDecoration: 'none',
}
const link = { color: '#1a6b54', textDecoration: 'underline', wordBreak: 'break-all' as const }
const signoff = { fontSize: '15px', color: '#3f4145', lineHeight: '1.6', margin: '0' }
