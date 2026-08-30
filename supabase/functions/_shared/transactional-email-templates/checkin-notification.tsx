/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface CheckinNotificationProps {
  clientName?: string
  feeling?: number | null
  waterLitres?: number | null
  notes?: string
}

const formatSubmittedAt = () => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date())
  } catch {
    return ''
  }
}

const CheckinNotificationEmail = ({
  clientName = 'A client',
  feeling = null,
  waterLitres = null,
  notes = '',
}: CheckinNotificationProps) => {
  const submittedAt = formatSubmittedAt()
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{clientName} submitted a check-in</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>New client check-in</Heading>
          <Text style={text}>
            {clientName} submitted a check-in{submittedAt ? ` on ${submittedAt}` : ''}.
          </Text>
          {typeof feeling === 'number' && (
            <Text style={text}>Feeling: {feeling}/5</Text>
          )}
          {typeof waterLitres === 'number' && (
            <Text style={text}>Water: {waterLitres} L</Text>
          )}
          {notes && notes.trim().length > 0 && (
            <Text style={text}>
              <strong>Client note:</strong> {notes.trim()}
            </Text>
          )}
          <Text style={signoff}>— Tenacia</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: CheckinNotificationEmail,
  subject: (data: Record<string, unknown>) =>
    `${(data?.clientName as string) || 'A client'} submitted a check-in`,
  displayName: 'Check-in notification',
  previewData: {
    clientName: 'Jane',
    feeling: 4,
    waterLitres: 1.5,
    notes: 'Feeling good today',
  },
} satisfies TemplateEntry

export default CheckinNotificationEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '24px 25px', maxWidth: '560px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#111111',
  margin: '0 0 20px',
}
const text = { fontSize: '15px', color: '#3f4145', lineHeight: '1.6', margin: '0 0 18px' }
const signoff = { fontSize: '15px', color: '#3f4145', lineHeight: '1.6', margin: '0' }
