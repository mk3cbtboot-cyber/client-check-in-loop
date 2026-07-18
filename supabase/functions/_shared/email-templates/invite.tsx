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

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You have been invited to {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You have been invited to {siteName}</Heading>
        <Text style={text}>
          You have been invited to join {siteName}.
        </Text>
        <Text style={text}>
          Accept the invitation to set up your account and get started.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Accept invitation
        </Button>
        <Text style={fallback}>
          If the button does not work, copy and paste this link into your browser:{' '}
          <Link href={confirmationUrl} style={link}>
            {confirmationUrl}
          </Link>
        </Text>
        <Text style={footer}>
          If you were not expecting this invitation, you can ignore this email.
        </Text>
        <Text style={signoff}>The {siteName} team</Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 25px',
}
const fallback = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 15px',
}
const link = { color: 'inherit', textDecoration: 'underline', wordBreak: 'break-all' as const }
const button = {
  backgroundColor: '#000000',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const footer = { fontSize: '14px', color: '#55575d', lineHeight: '1.5', margin: '0 0 15px' }
const signoff = { fontSize: '14px', color: '#55575d', lineHeight: '1.5', margin: '0' }
