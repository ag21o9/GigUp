import { Router } from "express";
import multer from "multer";

import prisma from "../prisma.config.js";
import {
    signup,
    login,
    updateProfile,
    getProfile,
    getAllFreelancers
} from "./auth.js";
import { authenticateToken, checkClientActive } from "../middleware/auth.js";
import { setCache, getCache, deleteCache } from "../utils/redis.js";

export const clientRouter = Router();

// Configure multer for file uploads (profile images)
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Authentication Routes (Public)
clientRouter.post('/signup', upload.single('profileImage'), signup);
clientRouter.post('/login', login);

// Profile Management Routes (Protected)
clientRouter.get('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const cacheKey = `client:profile:${userId}`;

        // Check cache
        const cachedProfile = await getCache(cacheKey);
        if (cachedProfile) {
            return res.status(200).json({
                success: true,
                data: cachedProfile
            });
        }

        // Fetch profile from database
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                client: {
                    include: {
                        projects: true
                    }
                }
            }
        });

        if (!user || user.role !== 'CLIENT') {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        // Cache the profile
        await setCache(cacheKey, user, 600); // Cache for 10 minutes

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

clientRouter.put('/profile', authenticateToken, upload.single('profileImage'), async (req, res) => {
    try {
        const userId = req.user.userId;

        // Update profile logic...
        const result = await updateProfile(req, res);

        // Invalidate cache
        const cacheKey = `client:profile:${userId}`;
        await deleteCache(cacheKey);

        return result;
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Freelancer Management Routes (Protected)
clientRouter.get('/freelancers', authenticateToken, getAllFreelancers);

// Project Management Routes (Protected)
// POST /api/client/projects - Create a new project
clientRouter.post('/projects', authenticateToken, checkClientActive, async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            title,
            description,
            skillsRequired,
            budgetMin,
            budgetMax,
            duration
        } = req.body;

        // Validation
        if (!title) {
            return res.status(400).json({
                success: false,
                message: 'Project title is required'
            });
        }

        // Check if user is a client
        const client = await prisma.client.findUnique({
            where: { userId }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        // Create project
        const project = await prisma.project.create({
            data: {
                title,
                description,
                clientId: client.id,
                skillsRequired: skillsRequired ? skillsRequired.split(',').map(skill => skill.trim()) : [],
                budgetMin: budgetMin ? parseFloat(budgetMin) : null,
                budgetMax: budgetMax ? parseFloat(budgetMax) : null,
                duration
            },
            include: {
                client: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                profileImage: true
                            }
                        }
                    }
                }
            }
        });

        // Update client's projects posted count
        await prisma.client.update({
            where: { id: client.id },
            data: {
                projectsPosted: {
                    increment: 1
                }
            }
        });

        res.status(201).json({
            success: true,
            message: 'Project created successfully',
            data: project
        });

    } catch (error) {
        console.error('Create project error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/client/projects - Get client's posted projects
clientRouter.get('/projects', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { status, page = 1, limit = 10 } = req.query;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const client = await prisma.client.findUnique({
            where: { userId }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        const whereClause = {
            clientId: client.id
        };

        if (status) {
            whereClause.status = status.toUpperCase();
        }

        const projects = await prisma.project.findMany({
            where: whereClause,
            include: {
                freelancer: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                email: true,
                                profileImage: true
                            }
                        }
                    }
                },
                applications: {
                    select: {
                        id: true,
                        status: true,
                        createdAt: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            skip,
            take: parseInt(limit)
        });

        const totalProjects = await prisma.project.count({
            where: whereClause
        });

        res.status(200).json({
            success: true,
            data: {
                projects,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalProjects,
                    pages: Math.ceil(totalProjects / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Get projects error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/client/projects/:projectId/applications - Get all applications for a specific project
clientRouter.get('/projects/:projectId/applications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { projectId } = req.params;
        const { status, page = 1, limit = 10 } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Check if user is a client
        const client = await prisma.client.findUnique({
            where: { userId }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        // Check if project belongs to this client
        const project = await prisma.project.findFirst({
            where: {
                id: projectId,
                clientId: client.id
            }
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found or you do not have permission to view it'
            });
        }

        const whereClause = {
            projectId
        };

        if (status) {
            whereClause.status = status.toUpperCase();
        }

        const applications = await prisma.application.findMany({
            where: whereClause,
            include: {
                freelancer: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                email: true,
                                profileImage: true,
                                bio: true,
                                location: true
                            }
                        }
                    }
                },
                project: {
                    select: {
                        title: true,
                        description: true,
                        skillsRequired: true,
                        budgetMin: true,
                        budgetMax: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            skip,
            take: parseInt(limit)
        });

        const totalApplications = await prisma.application.count({
            where: whereClause
        });

        res.status(200).json({
            success: true,
            data: {
                applications,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalApplications,
                    pages: Math.ceil(totalApplications / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Get project applications error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// PUT /api/client/projects/:projectId/applications/:applicationId/approve - Approve an application
clientRouter.put('/projects/:projectId/applications/:applicationId/approve', authenticateToken, checkClientActive, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { projectId, applicationId } = req.params;

        // Check if user is a client
        const client = await prisma.client.findUnique({
            where: { userId }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        // Check if project belongs to this client
        const project = await prisma.project.findFirst({
            where: {
                id: projectId,
                clientId: client.id
            }
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found or you do not have permission to modify it'
            });
        }

        if (project.status !== 'OPEN') {
            return res.status(400).json({
                success: false,
                message: 'Project is not available for assignment'
            });
        }

        // Check if application exists and belongs to this project
        const application = await prisma.application.findFirst({
            where: {
                id: applicationId,
                projectId
            },
            include: {
                freelancer: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                email: true,
                                profileImage: true
                            }
                        }
                    }
                }
            }
        });

        if (!application) {
            return res.status(404).json({
                success: false,
                message: 'Application not found'
            });
        }

        if (application.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: 'Application has already been processed'
            });
        }

        // Use transaction to approve application and assign project
        const result = await prisma.$transaction(async (tx) => {
            // Approve the application
            const approvedApplication = await tx.application.update({
                where: { id: applicationId },
                data: { status: 'APPROVED' },
                include: {
                    freelancer: {
                        include: {
                            user: {
                                select: {
                                    name: true,
                                    email: true,
                                    profileImage: true
                                }
                            }
                        }
                    }
                }
            });

            // Assign project to freelancer
            const updatedProject = await tx.project.update({
                where: { id: projectId },
                data: {
                    assignedTo: application.freelancerId,
                    status: 'ASSIGNED'
                }
            });

            // Reject all other pending applications for this project
            await tx.application.updateMany({
                where: {
                    projectId,
                    id: { not: applicationId },
                    status: 'PENDING'
                },
                data: { status: 'REJECTED' }
            });

            return { approvedApplication, updatedProject };
        });

        res.status(200).json({
            success: true,
            message: 'Application approved and project assigned successfully',
            data: result.approvedApplication
        });

    } catch (error) {
        console.error('Approve application error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// PUT /api/client/projects/:projectId/applications/:applicationId/reject - Reject an application
clientRouter.put('/projects/:projectId/applications/:applicationId/reject', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { projectId, applicationId } = req.params;

        // Check if user is a client
        const client = await prisma.client.findUnique({
            where: { userId }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        // Check if project belongs to this client
        const project = await prisma.project.findFirst({
            where: {
                id: projectId,
                clientId: client.id
            }
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found or you do not have permission to modify it'
            });
        }

        // Check if application exists and belongs to this project
        const application = await prisma.application.findFirst({
            where: {
                id: applicationId,
                projectId
            }
        });

        if (!application) {
            return res.status(404).json({
                success: false,
                message: 'Application not found'
            });
        }

        if (application.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: 'Application has already been processed'
            });
        }

        // Reject the application
        const rejectedApplication = await prisma.application.update({
            where: { id: applicationId },
            data: { status: 'REJECTED' },
            include: {
                freelancer: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                email: true,
                                profileImage: true
                            }
                        }
                    }
                }
            }
        });

        res.status(200).json({
            success: true,
            message: 'Application rejected successfully',
            data: rejectedApplication
        });

    } catch (error) {
        console.error('Reject application error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/client/applications - Get all applications for all projects
clientRouter.get('/applications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { status, page = 1, limit = 10 } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Check if user is a client
        const client = await prisma.client.findUnique({
            where: { userId }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        const whereClause = {
            project: {
                clientId: client.id
            }
        };

        if (status) {
            whereClause.status = status.toUpperCase();
        }

        const applications = await prisma.application.findMany({
            where: whereClause,
            include: {
                freelancer: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                email: true,
                                profileImage: true,
                                bio: true,
                                location: true
                            }
                        }
                    }
                },
                project: {
                    select: {
                        id: true,
                        title: true,
                        description: true,
                        skillsRequired: true,
                        budgetMin: true,
                        budgetMax: true,
                        status: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            skip,
            take: parseInt(limit)
        });

        const totalApplications = await prisma.application.count({
            where: whereClause
        });

        // Group applications by project
        const groupedApplications = applications.reduce((acc, app) => {
            const projectId = app.project.id;
            if (!acc[projectId]) {
                acc[projectId] = {
                    project: app.project,
                    applications: []
                };
            }
            acc[projectId].applications.push(app);
            return acc;
        }, {});

        res.status(200).json({
            success: true,
            data: {
                applications,
                groupedApplications: Object.values(groupedApplications),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalApplications,
                    pages: Math.ceil(totalApplications / parseInt(limit))
                }
            }
        });

    } catch (error) {
        console.error('Get all applications error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/client/dashboard - Get client dashboard data
clientRouter.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const cacheKey = `client:dashboard:${userId}`;

        // Check cache
        const cachedDashboard = await getCache(cacheKey);
        if (cachedDashboard) {
            return res.status(200).json({
                success: true,
                data: cachedDashboard
            });
        }

        // Fetch dashboard data from database
        const client = await prisma.client.findUnique({
            where: { userId },
            include: {
                projects: {
                    include: {
                        applications: true
                    }
                }
            }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        const stats = {
            totalProjects: client.projectsPosted,
            openProjects: client.projects.filter(p => p.status === 'OPEN').length,
            assignedProjects: client.projects.filter(p => p.status === 'ASSIGNED').length,
            completedProjects: client.projects.filter(p => p.status === 'COMPLETED').length,
            pendingApplications: client.projects.reduce((sum, project) => sum + project.applications.length, 0)
        };

        const dashboardData = { client, stats };

        // Cache the dashboard data
        await setCache(cacheKey, dashboardData, 300); // Cache for 5 minutes

        res.status(200).json({
            success: true,
            data: dashboardData
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// PUT /api/client/projects/:projectId/approve-completion - Approve project completion
clientRouter.put('/projects/:projectId/approve-completion', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { projectId } = req.params;
        const { feedback, rating } = req.body; // Optional: client feedback and rating

        // Check if client exists
        const client = await prisma.client.findUnique({
            where: { userId }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        // Check if project belongs to this client and is pending completion
        const project = await prisma.project.findFirst({
            where: {
                id: projectId,
                clientId: client.id,
                status: 'PENDING_COMPLETION'
            },
            include: {
                freelancer: true
            }
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found or not pending completion'
            });
        }

        // Update project status to COMPLETED and increment freelancer's completed projects
        const updatedProject = await prisma.$transaction(async (tx) => {
            // Update project status
            const project = await tx.project.update({
                where: { id: projectId },
                data: { 
                    status: 'COMPLETED',
                    updatedAt: new Date()
                }
            });

            // Update freelancer's completed projects count
            await tx.freelancer.update({
                where: { id: project.assignedTo },
                data: {
                    projectsCompleted: {
                        increment: 1
                    }
                }
            });

            return project;
        });

        // Invalidate cache
        await deleteCache(`client:projects:${userId}`);
        await deleteCache(`freelancer:projects:${project.freelancer.userId}`);

        res.status(200).json({
            success: true,
            message: 'Project completion approved successfully.',
            data: updatedProject
        });

    } catch (error) {
        console.error('Approve project completion error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// PUT /api/client/projects/:projectId/reject-completion - Reject project completion
clientRouter.put('/projects/:projectId/reject-completion', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { projectId } = req.params;
        const { rejectionReason } = req.body; // Required: reason for rejection

        if (!rejectionReason) {
            return res.status(400).json({
                success: false,
                message: 'Rejection reason is required'
            });
        }

        // Check if client exists
        const client = await prisma.client.findUnique({
            where: { userId }
        });

        if (!client) {
            return res.status(404).json({
                success: false,
                message: 'Client not found'
            });
        }

        // Check if project belongs to this client and is pending completion
        const project = await prisma.project.findFirst({
            where: {
                id: projectId,
                clientId: client.id,
                status: 'PENDING_COMPLETION'
            }
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found or not pending completion'
            });
        }

        // Update project status back to ASSIGNED (so freelancer can continue working)
        const updatedProject = await prisma.project.update({
            where: { id: projectId },
            data: { 
                status: 'ASSIGNED', // Back to assigned so freelancer can continue
                updatedAt: new Date()
            }
        });

        // Invalidate cache
        await deleteCache(`client:projects:${userId}`);

        res.status(200).json({
            success: true,
            message: 'Project completion request rejected. Freelancer has been notified.',
            data: {
                project: updatedProject,
                rejectionReason
            }
        });

    } catch (error) {
        console.error('Reject project completion error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Error handling middleware for multer
clientRouter.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File size too large. Maximum size is 5MB.'
            });
        }
    }
    
    if (error.message === 'Only image files are allowed') {
        return res.status(400).json({
            success: false,
            message: 'Only image files are allowed for profile pictures.'
        });
    }
    
    next(error);
});


