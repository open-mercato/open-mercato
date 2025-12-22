import { Meta, StoryObj } from '@storybook/react'
import { Button } from './button'
import { Badge } from './badge'
import { Input } from './input'
import { Label } from './label'
import { Textarea } from './textarea'
import { Switch } from './switch'
import { Separator } from './separator'
import { Spinner } from './spinner'
import { Alert, AlertDescription, AlertTitle } from './alert'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'
import { SimpleTooltip } from './tooltip'
import { ErrorNotice } from './ErrorNotice'
import { DataLoader } from './DataLoader'

const ShowcaseComponent = () => {
    return (
        <div className="space-y-12 max-w-6xl">
            {/* Actions */}
            <section>
                <h2 className="text-2xl font-bold mb-4">Actions</h2>
                <div className="space-y-4">
                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-2">Buttons</h3>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="default">Default</Button>
                            <Button variant="destructive">Destructive</Button>
                            <Button variant="outline">Outline</Button>
                            <Button variant="secondary">Secondary</Button>
                            <Button variant="ghost">Ghost</Button>
                            <Button variant="link">Link</Button>
                            <Button disabled>Disabled</Button>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-2">Button Sizes</h3>
                        <div className="flex items-center gap-2">
                            <Button size="sm">Small</Button>
                            <Button size="default">Default</Button>
                            <Button size="lg">Large</Button>
                            <Button size="icon">🔍</Button>
                        </div>
                    </div>
                </div>
            </section>

            {/* Forms */}
            <section>
                <h2 className="text-2xl font-bold mb-4">Forms</h2>
                <div className="space-y-6 max-w-md">
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" placeholder="Enter your email" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <Input id="password" type="password" placeholder="Enter password" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="message">Message</Label>
                        <Textarea id="message" placeholder="Type your message here" />
                    </div>
                    <div className="flex items-center space-x-2">
                        <Switch id="notifications" />
                        <Label htmlFor="notifications">Enable notifications</Label>
                    </div>
                </div>
            </section>

            {/* Feedback */}
            <section>
                <h2 className="text-2xl font-bold mb-4">Feedback</h2>
                <div className="space-y-4">
                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-2">Badges</h3>
                        <div className="flex flex-wrap gap-2">
                            <Badge variant="default">Default</Badge>
                            <Badge variant="secondary">Secondary</Badge>
                            <Badge variant="destructive">Destructive</Badge>
                            <Badge variant="outline">Outline</Badge>
                            <Badge variant="muted">Muted</Badge>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-2">Alerts</h3>
                        <div className="space-y-2">
                            <Alert>
                                <AlertTitle>Information</AlertTitle>
                                <AlertDescription>This is a default alert with important information.</AlertDescription>
                            </Alert>
                            <Alert variant="destructive">
                                <AlertTitle>Error</AlertTitle>
                                <AlertDescription>Something went wrong. Please try again.</AlertDescription>
                            </Alert>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-2">Loading States</h3>
                        <div className="flex items-center gap-4">
                            <Spinner />
                            <Spinner className="size-6" />
                            <Spinner className="size-8" />
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-2">Error Notice</h3>
                        <ErrorNotice title='An example error occurred' />
                    </div>

                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-2">Data Loader</h3>
                        <DataLoader isLoading={true}>
                            <div>Content loaded successfully</div>
                        </DataLoader>
                    </div>
                </div>
            </section>

            {/* Layout */}
            <section>
                <h2 className="text-2xl font-bold mb-4">Layout</h2>
                <div className="space-y-4">
                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-2">Separator</h3>
                        <div className="space-y-2">
                            <div>Above separator</div>
                            <Separator />
                            <div>Below separator</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Overlays */}
            <section>
                <h2 className="text-2xl font-bold mb-4">Overlays</h2>
                <div className="space-y-4">
                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-2">Dialog</h3>
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button>Open Dialog</Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Dialog Title</DialogTitle>
                                    <DialogDescription>
                                        This is a dialog with some example content.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="py-4">
                                    Dialog content goes here.
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-2">Tooltip</h3>
                        <SimpleTooltip content="This is a helpful tooltip">
                            <Button variant="outline">Hover me</Button>
                        </SimpleTooltip>
                    </div>
                </div>
            </section>

            {/* Data Display */}
            <section>
                <h2 className="text-2xl font-bold mb-4">Data Display</h2>
                <div className="space-y-4">
                    <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-2">Table</h3>
                        <div className="border rounded-lg">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Role</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    <TableRow>
                                        <TableCell>John Doe</TableCell>
                                        <TableCell><Badge variant="default">Active</Badge></TableCell>
                                        <TableCell>Admin</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell>Jane Smith</TableCell>
                                        <TableCell><Badge variant="secondary">Pending</Badge></TableCell>
                                        <TableCell>User</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell>Bob Johnson</TableCell>
                                        <TableCell><Badge variant="muted">Inactive</Badge></TableCell>
                                        <TableCell>User</TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    )
}

const meta: Meta<typeof ShowcaseComponent> = {
    title: 'Primitives/Primitives',
    component: ShowcaseComponent,
    parameters: {
        layout: 'padded',
    },
}

export default meta
type Story = StoryObj<typeof ShowcaseComponent>

export const AllComponents: Story = {}