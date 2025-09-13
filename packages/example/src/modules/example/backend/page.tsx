"use client"
import * as React from 'react'
import { Page, PageHeader, PageBody } from '@mercato-ui/backend/Page'
import Link from 'next/link'

export default function ExampleAdminIndex() {
  return (
    <Page>
      <PageHeader title="Example Admin" description="Demo resources for the example module." />
      <PageBody>
        <div className="rounded-lg border p-4">
          <div className="text-sm mb-2">Resources</div>
          <ul className="list-disc list-inside text-sm">
            <li>
              <Link className="underline" href="/backend/products">Products list</Link>
            </li>
          </ul>
        </div>
      </PageBody>
    </Page>
  )
}

