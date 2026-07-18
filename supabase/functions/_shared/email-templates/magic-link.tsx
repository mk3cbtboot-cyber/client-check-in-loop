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

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {siteName} sign-in link</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your {siteName} sign-in link</Heading>
        <Text style={text}>
          Here is your secure sign-in link for {siteName}.
        </Text>
        <Text style={text}>
          Sign in using the button below. For your security, this link will expire soon.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Sign in to {siteName}
        </Button>
        <Text style={fallback}>
          If the button does not work, copy and paste this link into your browser:{' '}
          <Link href={confirmationUrl} style={link}>
            {confirmationUrl}
          </Link>
        </Text>
        <Text style={footer}>
          If you did not request this link, you can ignore this email.
        </Text>
        <Text style={signoff}>The {siteName} team</Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

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
