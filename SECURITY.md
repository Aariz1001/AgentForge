# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in AgentForge, please email **aarizwaqqas3@gmail.com** instead of using the issue tracker.

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any proposed fixes

We will acknowledge your report within 48 hours and provide updates as we investigate and release a fix.

## Security Best Practices

### For Users

1. **Keep Dependencies Updated**: Regularly run `npm update`
2. **Protect Your API Keys**: Never commit `.env` files
3. **Use Strong Session Credentials**: Enable 2FA where possible
4. **Monitor Costs**: Set budget limits on your OpenRouter account

### For Developers

1. **Input Validation**: All user inputs must be validated
2. **Code Sanitization**: Never execute untrusted code directly
3. **Secret Management**: Use environment variables for secrets
4. **Dependency Audit**: Run `npm audit` regularly

## Known Vulnerabilities

None currently known. Report any findings to security@agentforge.dev.

## Supported Versions

| Version | Status | Supported Until |
|---------|--------|-----------------|
| 1.x.x   | Active | TBD |

## Security Features

- Input sanitization and validation
- Sandboxed tool execution
- Rate limiting and cost controls
- Session encryption
- API key isolation

## Changelog

All security-related changes are documented in [CHANGELOG.md](CHANGELOG.md).
