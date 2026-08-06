/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface ClientInviteProps {
  client_first_name?: string
  practitioner_name?: string
  portal_url?: string
}

const ClientInviteEmail = ({
  client_first_name = 'there',
  practitioner_name = 'your practitioner',
  portal_url = '',
}: ClientInviteProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Tenacia portal link is ready</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You are set up on Tenacia</Heading>
        <Text style={text}>Hi {client_first_name},</Text>
        <Text style={text}>
          {practitioner_name} has set you up on Tenacia, the app you will use to follow your plan
          day to day. It is where you will see your meals, log what you eat, complete your
          check-ins, and stay on track between appointments.
        </Text>
        <Text style={text}>Here is your private link to get started:</Text>
        <Text style={linkWrap}>
          <Link href={portal_url} style={link}>
            {portal_url}
          </Link>
        </Text>
        <Text style={text}>
          There is no password to remember. Just tap the link to open your portal, and bookmark it
          so it is easy to find again. Keep it to yourself, since anyone with the link can see your
          plan.
        </Text>
        <Text style={text}>
          Have a question about your plan? Send it to {practitioner_name} right inside the app.
        </Text>
        <Text style={signoff}>Talk soon,</Text>
        <Text style={signoff}>Tenacia</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ClientInviteEmail,
  subject: (data: Record<string, unknown>) =>
    `You're set up on Tenacia, ${(data?.client_first_name as string) || 'welcome'}`,
  displayName: 'Client portal invite',
  previewData: {
    client_first_name: 'Jane',
    practitioner_name: 'Cheryl',
    portal_url: 'https://tenacia.app/portal/sample-token',
  },
} satisfies TemplateEntry

export default ClientInviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '24px 25px', maxWidth: '560px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#111111',
  margin: '0 0 20px',
}
const text = { fontSize: '15px', color: '#3f4145', lineHeight: '1.6', margin: '0 0 18px' }
const linkWrap = { fontSize: '15px', lineHeight: '1.6', margin: '0 0 18px' }
const link = { color: '#1a6b54', textDecoration: 'underline', wordBreak: 'break-all' as const }
const signoff = { fontSize: '15px', color: '#3f4145', lineHeight: '1.6', margin: '0' }
