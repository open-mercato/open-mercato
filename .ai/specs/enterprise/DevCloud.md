# Open Mercato — Developer's Cloud

## Service Description

Developer's Cloud is a managed infrastructure environment for Open Mercato clients. It covers full setup, maintenance and monitoring of production or development infrastructure based on Dokploy + VPS (Hetzner or client's own infrastructure).

The service provides the client with a ready-to-use, secure and monitored environment — without the need for an in-house DevOps team.

---

## What's Included

### Setup (one-time)
- VPS provisioning and security hardening (fail2ban, SSH keys only, firewall, root login disabled)
- Dokploy installation and configuration
- CI/CD configuration for application deployment - GitHub repository integration
- Domain / DNS / SSL configuration
- Automated backup configuration (snapshots + remote backup to S3)
- Monitoring and alerting setup (uptime, CPU, RAM, disk, logs)
- Client onboarding doc — how to deploy, how to report issues, what's covered by support

### Monthly Maintenance
- Infrastructure monitoring and alert response
- System and Dokploy updates (security patches)
- Quarterly backup restore testing in a recovery environment
- Deployment assistance and infrastructure-level troubleshooting
- Quarterly security review (CVEs, certificates, backup status)
- **4h of support per month** included in the package

### SLA
- **Response time:** up to 24h (business hours, Mon–Fri 9–17 CET)
- **Support channels:** email / Slack / dedicated channel
- **Coverage continuity:** mutual backup with a second engineer — service continuity in case of vacation or sick leave

---

## What's NOT Included

- Application code debugging and fixes (business logic, bugs in Node/Python/etc.)
- Development of new application features
- Integration with client's external systems — **priced separately**
- Data migration between environments — **priced separately**
- Work exceeding 4h/month 

### Responsibility Boundary
Everything related to infrastructure, Docker, Terraform, server configuration and deployment — **DevOps responsibility**. 
Application code — **development team responsibility**.

---

## Pricing

| Item | Price |
|---|---|
| Setup — Hetzner (standard) | **Please Contact us** |
| Setup — client infrastructure (custom) | **quoted individually**  |
| Monthly maintenance + 24h SLA + 4h support | **Please Contact us** |
| Additional hours beyond package | **Please Contact us** |
| Client system integrations | **quoted individually** |

---

## Additional Information

- Standard stack: **Dokploy + Hetzner VPS**. Other providers (AWS, GCP, Azure) available — setup priced individually.
- Ownership of IaC, scripts and templates remains with **Open Mercato** — enabling reuse and continuous service improvement.