import { Router } from "express";
import multer from "multer";
import {
    signup,
    login,
    updateProfile,
    getProfile,
    updateAvailability
} from "./auth.js";

import { authenticateToken } from "../middleware/auth.js";
import { setCache, getCache, deleteCache } from "../utils/redis.js";

import prisma from "../prisma.config.js";

export const flRouter = Router();

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
flRouter.post('/signup', upload.single('profileImage'), signup);
flRouter.post('/login', login);

// Profile Management Routes (Protected)
flRouter.get('/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const cacheKey = `freelancer:profile:${userId}`;

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
                freelancer: true
            }
        });

        if (!user || user.role !== 'FREELANCER') {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
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

flRouter.put('/profile', authenticateToken, upload.single('profileImage'), async (req, res) => {
    try {
        const userId = req.user.userId;

        // Update profile logic...
        const result = await updateProfile(req, res);

        // Invalidate cache
        const cacheKey = `freelancer:profile:${userId}`;
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

// GET /api/freelancer/dashboard - Get dashboard data
flRouter.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const cacheKey = `freelancer:dashboard:${userId}`;

        // Check cache
        const cachedDashboard = await getCache(cacheKey);
        if (cachedDashboard) {
            return res.status(200).json({
                success: true,
                data: cachedDashboard
            });
        }

        // Fetch dashboard data from database
        const freelancer = await prisma.freelancer.findUnique({
            where: { userId },
            include: {
                assignedProjects: true,
                applications: true
            }
        });

        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }

        const stats = {
            totalProjects: freelancer.projectsCompleted,
            activeProjects: freelancer.assignedProjects.filter(p => p.status === 'ASSIGNED').length,
            completedProjects: freelancer.assignedProjects.filter(p => p.status === 'COMPLETED').length,
            pendingApplications: freelancer.applications.filter(app => app.status === 'PENDING').length
        };

        const dashboardData = { freelancer, stats };

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

// GET /api/freelancer/projects - Get freelancer's projects
flRouter.get('/projects', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { status, page = 1, limit = 10 } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const whereClause = {
            freelancer: {
                userId
            }
        };

        if (status) {
            whereClause.status = status.toUpperCase();
        }

        const projects = await prisma.project.findMany({
            where: whereClause,
            include: {
                client: {
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

// GET /api/freelancer/projects/available - Get available projects for freelancer
flRouter.get('/projects/available', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { skills, budgetMin, budgetMax, page = 1, limit = 10 } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Get freelancer's skills for filtering
        const freelancer = await prisma.freelancer.findUnique({
            where: { userId },
            select: { skills: true, id: true }
        });

        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }

        const whereClause = {
            status: 'OPEN',
            assignedTo: null
        };

        // Filter by skills if provided, otherwise use freelancer's skills
        const skillsToFilter = skills ? skills.split(',') : freelancer.skills;
        if (skillsToFilter.length > 0) {
            whereClause.skillsRequired = {
                hasSome: skillsToFilter
            };
        }

        // Filter by budget
        if (budgetMin) {
            whereClause.budgetMin = { gte: parseFloat(budgetMin) };
        }
        if (budgetMax) {
            whereClause.budgetMax = { lte: parseFloat(budgetMax) };
        }

        const projects = await prisma.project.findMany({
            where: whereClause,
            include: {
                client: {
                    include: {
                        user: {
                            select: {
                                name: true,
                                profileImage: true,
                                location: true
                            }
                        }
                    }
                },
                applications: {
                    where: {
                        freelancerId: freelancer.id
                    },
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
        console.error('Get available projects error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// POST /api/freelancer/projects/:projectId/apply - Apply for a project
flRouter.post('/projects/:projectId/apply', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { projectId } = req.params;
        const { proposal, coverLetter } = req.body;

        // Check if freelancer exists and is available
        const freelancer = await prisma.freelancer.findUnique({
            where: { userId }
        });

        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }

        if (!freelancer.availability) {
            return res.status(400).json({
                success: false,
                message: 'You must be available to apply for projects'
            });
        }

        // Check if project exists and is open
        const project = await prisma.project.findUnique({
            where: { id: projectId },
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

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found'
            });
        }

        if (project.status !== 'OPEN') {
            return res.status(400).json({
                success: false,
                message: 'Project is not available for applications'
            });
        }

        if (project.assignedTo) {
            return res.status(400).json({
                success: false,
                message: 'Project is already assigned'
            });
        }

        // Check if freelancer has already applied
        const existingApplication = await prisma.application.findUnique({
            where: {
                projectId_freelancerId: {
                    projectId,
                    freelancerId: freelancer.id
                }
            }
        });

        if (existingApplication) {
            return res.status(400).json({
                success: false,
                message: 'You have already applied for this project'
            });
        }

        // Create application
        const application = await prisma.application.create({
            data: {
                projectId,
                freelancerId: freelancer.id,
                proposal,
                coverLetter
            },
            include: {
                project: {
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
                },
                freelancer: {
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

        res.status(201).json({
            success: true,
            message: 'Application submitted successfully',
            data: application
        });

    } catch (error) {
        console.error('Apply for project error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/freelancer/applications - Get all applications
flRouter.get('/applications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { status, page = 1, limit = 10 } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const freelancer = await prisma.freelancer.findUnique({
            where: { userId },
            select: { id: true }
        });

        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }

        const whereClause = {
            freelancerId: freelancer.id
        };

        if (status) {
            whereClause.status = status.toUpperCase();
        }

        const applications = await prisma.application.findMany({
            where: whereClause,
            include: {
                project: {
                    include: {
                        client: {
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
        console.error('Get applications error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// PUT /api/freelancer/projects/:projectId/request-completion - Request project completion
flRouter.put('/projects/:projectId/request-completion', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { projectId } = req.params;
        const { deliverables, completionNote } = req.body; // Optional: deliverables and notes

        // Check if freelancer exists
        const freelancer = await prisma.freelancer.findUnique({
            where: { userId }
        });

        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }

        // Check if project exists and is assigned to this freelancer
        const project = await prisma.project.findFirst({
            where: {
                id: projectId,
                assignedTo: freelancer.id,
                status: 'ASSIGNED'
            },
            include: {
                client: {
                    include: {
                        user: true
                    }
                }
            }
        });

        if (!project) {
            return res.status(404).json({
                success: false,
                message: 'Project not found, not assigned to you, or not in correct status'
            });
        }

        // Update project status to PENDING_COMPLETION
        const updatedProject = await prisma.project.update({
            where: { id: projectId },
            data: { 
                status: 'PENDING_COMPLETION',
                updatedAt: new Date()
            },
            include: {
                client: {
                    include: {
                        user: true
                    }
                }
            }
        });

        // Invalidate cache
        await deleteCache(`freelancer:projects:${userId}`);
        await deleteCache(`client:projects:${project.client.userId}`);

        res.status(200).json({
            success: true,
            message: 'Completion request submitted. Awaiting client approval.',
            data: updatedProject
        });

    } catch (error) {
        console.error('Request project completion error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Error handling middleware for multer
flRouter.use((error, req, res, next) => {
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




